import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { get } from "node:http";
import type { ClientRequest, IncomingMessage } from "node:http";

const helperUrl = new URL(
  "../../scripts/graceful-shutdown.mjs",
  import.meta.url,
);
const childSource = `
import { createServer } from "node:http";
import { installGracefulShutdown } from ${JSON.stringify(helperUrl.href)};

let activeResponse;
const server = createServer((_request, response) => {
  activeResponse = response;
  response.writeHead(200, { "content-type": "text/plain" });
  response.write("started\\n");
});
server.keepAliveTimeout = 60_000;
installGracefulShutdown(server);
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => process.send({ type: "signal", signal }));
}
process.on("message", (message) => {
  if (message === "finish") activeResponse.end("finished\\n");
});
server.listen(0, "127.0.0.1", () => {
  process.send({ type: "ready", port: server.address().port });
});
`;

async function startResponse() {
  const child = spawn("node", ["--input-type=module", "--eval", childSource], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk) => (stderr += chunk));
  const exit = Promise.withResolvers<{
    code: number | null;
    signal: string | null;
  }>();
  const closed = exit.promise;
  child.once("error", exit.reject);
  child.once("close", (code, signal) => exit.resolve({ code, signal }));
  // Keep early startup failures handled while waiting for the ready message.
  void closed.catch(() => {});
  let request: ClientRequest | undefined;
  let response: IncomingMessage | undefined;
  const cleanup = async () => {
    response?.destroy();
    request?.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await closed;
  };
  try {
    const ready = once(child, "message");
    const [message] = await Promise.race([
      ready,
      closed.then(() => {
        throw new Error(`Shutdown child exited before listening: ${stderr}`);
      }),
    ]);
    if (
      !message ||
      typeof message !== "object" ||
      !("port" in message) ||
      typeof message.port !== "number"
    ) {
      throw new Error("Shutdown child did not report its port");
    }
    const port = message.port;
    request = get({ host: "127.0.0.1", port, agent: false });
    [response] = (await once(request, "response")) as [IncomingMessage];
    let body = "";
    response.setEncoding("utf8");
    const firstChunk = once(response, "data");
    const completion = Promise.withResolvers<string>();
    const completed = completion.promise;
    response.on("data", (chunk) => (body += chunk));
    response.once("end", () => completion.resolve(body));
    response.once("error", completion.reject);
    response.once("aborted", () =>
      completion.reject(new Error("Response aborted")),
    );
    void completed.catch(() => {});
    await firstChunk;
    return {
      port,
      completed,
      closed,
      cleanup,
      stderr: () => stderr,
      async signal(signal: "SIGTERM" | "SIGINT") {
        const acknowledged = once(child, "message");
        if (!child.kill(signal)) throw new Error(`Could not send ${signal}`);
        const [message] = await Promise.race([
          acknowledged,
          closed.then(() => {
            throw new Error(`Shutdown child exited before handling ${signal}`);
          }),
        ]);
        expect(message).toEqual({ type: "signal", signal });
      },
      finish() {
        child.send("finish");
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

describe("graceful shutdown", () => {
  test("SIGTERM drains an active streamed response before exiting successfully", async () => {
    const server = await startResponse();
    try {
      await server.signal("SIGTERM");
      server.finish();
      expect(await server.completed).toBe("started\nfinished\n");
      expect(await server.closed).toEqual({ code: 0, signal: null });
    } finally {
      await server.cleanup();
    }
  });

  test("a completed keepalive response closes promptly during shutdown", async () => {
    const server = spawn(
      "node",
      ["--input-type=module", "--eval", childSource],
      {
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      },
    );
    const serverClosed = once(server, "close");
    let client: ChildProcess | undefined;
    let clientClosed: Promise<unknown> | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      const [ready] = await Promise.race([
        once(server, "message"),
        serverClosed.then(() => {
          throw new Error("Keepalive server exited before listening");
        }),
      ]);
      if (
        !ready ||
        typeof ready !== "object" ||
        !("port" in ready) ||
        typeof ready.port !== "number"
      ) {
        throw new Error("Keepalive server did not report its port");
      }
      const clientSource = `
import { Agent, get } from "node:http";
const agent = new Agent({ keepAlive: true });
get({ host: "127.0.0.1", port: ${ready.port}, agent }, (response) => {
  let body = "";
  let started = false;
  response.setEncoding("utf8");
  response.on("data", (chunk) => {
    body += chunk;
    if (!started) {
      started = true;
      process.send({ type: "started" });
    }
  });
  response.once("end", () => process.send({ type: "completed", body }));
  response.once("error", (error) => { throw error; });
}).once("error", (error) => { throw error; });
`;
      client = spawn("node", ["--input-type=module", "--eval", clientSource], {
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
      clientClosed = once(client, "close");
      const [started] = await Promise.race([
        once(client, "message"),
        clientClosed.then(() => {
          throw new Error(
            "Keepalive client exited before receiving a response",
          );
        }),
      ]);
      expect(started).toEqual({ type: "started" });
      const signalled = once(server, "message");
      server.kill("SIGTERM");
      expect((await signalled)[0]).toEqual({
        type: "signal",
        signal: "SIGTERM",
      });
      const completed = once(client, "message");
      // This watchdog bounds a real Node process, not a Bun-controlled clock.
      const deadline = Promise.withResolvers<never>();
      timer = setTimeout(
        () =>
          deadline.reject(new Error("Keepalive connection delayed shutdown")),
        3_000,
      );
      server.send("finish");
      const [message, exit] = await Promise.race([
        Promise.all([completed, serverClosed]),
        deadline.promise,
      ]);
      expect(message[0]).toEqual({
        type: "completed",
        body: "started\nfinished\n",
      });
      expect(exit).toEqual([0, null]);
    } finally {
      clearTimeout(timer);
      if (server.exitCode === null && server.signalCode === null) {
        server.kill("SIGKILL");
      }
      if (client && client.exitCode === null && client.signalCode === null) {
        client.kill("SIGKILL");
      }
      await Promise.all([serverClosed, clientClosed]);
    }
  });

  test("new connections are refused while an active response drains", async () => {
    const server = await startResponse();
    try {
      await server.signal("SIGTERM");
      const attempt = Promise.withResolvers<Error>();
      const request = get({
        host: "127.0.0.1",
        port: server.port,
        agent: false,
      });
      request.once("error", attempt.resolve);
      request.once("response", (response) => {
        response.destroy();
        attempt.reject(
          new Error("Server accepted a new connection while draining"),
        );
      });
      const connectionError = await attempt.promise.finally(() =>
        request.destroy(),
      );
      expect("code" in connectionError && connectionError.code).toBe(
        "ECONNREFUSED",
      );
      server.finish();
      expect(await server.completed).toBe("started\nfinished\n");
      expect(await server.closed).toEqual({ code: 0, signal: null });
    } finally {
      await server.cleanup();
    }
  });

  test("duplicate SIGTERM and SIGINT do not abort an active response", async () => {
    const server = await startResponse();
    try {
      await server.signal("SIGTERM");
      await server.signal("SIGTERM");
      await server.signal("SIGINT");
      server.finish();
      expect(await server.completed).toBe("started\nfinished\n");
      expect(await server.closed).toEqual({ code: 0, signal: null });
    } finally {
      await server.cleanup();
    }
  });

  test("a hung response is terminated with a nonzero exit at the 15-second deadline", async () => {
    const server = await startResponse();
    // The real Node child's production deadline cannot use Bun's fake clock.
    const deadline = Promise.withResolvers<never>();
    const timer = setTimeout(
      () => deadline.reject(new Error("Shutdown exceeded the test deadline")),
      18_000,
    );
    void deadline.promise.catch(() => {});
    try {
      const started = performance.now();
      await server.signal("SIGTERM");
      const result = await Promise.race([server.closed, deadline.promise]);
      const elapsed = performance.now() - started;
      expect(result).toEqual({ code: 1, signal: null });
      expect(elapsed).toBeGreaterThanOrEqual(14_000);
      expect(elapsed).toBeLessThan(18_000);
      const completed = await server.completed.then(
        () => true,
        () => false,
      );
      expect(completed).toBe(false);
      expect(server.stderr()).toContain("deadline");
    } finally {
      clearTimeout(timer);
      await server.cleanup();
    }
  }, 20_000);
});
