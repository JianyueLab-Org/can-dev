import { afterEach, describe, expect, test } from "bun:test";

import { canApiCheck, createHealthHandler } from "./health";

/** `/health`：200、503、10 秒缓存、并发共用一次检查、can-api 非 2xx 失败。 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("createHealthHandler", () => {
  test("all checks pass → 200 ok, no-store", async () => {
    const handle = createHealthHandler({ "can-api": async () => {} });
    const response = await handle();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      checks: { "can-api": "ok" },
    });
  });

  test("failing check → 503 with short reason", async () => {
    const handle = createHealthHandler({
      "can-api": async () => {
        throw new Error("http 500");
      },
    });
    const response = await handle();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "fail",
      checks: { "can-api": "http 500" },
    });
  });

  test("slow check → timeout", async () => {
    const handle = createHealthHandler(
      { "can-api": () => new Promise(() => {}) },
      { timeoutMs: 10 },
    );
    const response = await handle();
    expect(response.status).toBe(503);
    expect((await response.json()).checks["can-api"]).toBe("timeout");
  });

  test("result cached for ttl; concurrent requests share one run", async () => {
    let runs = 0;
    let clock = 0;
    const gate = Promise.withResolvers<void>();
    const handle = createHealthHandler(
      {
        "can-api": async () => {
          runs++;
          await gate.promise;
        },
      },
      { now: () => clock },
    );
    const pending = Promise.all([handle(), handle(), handle()]);
    gate.resolve();
    await pending;
    expect(runs).toBe(1);
    clock = 9_999;
    await handle();
    expect(runs).toBe(1);
    clock = 20_000;
    await handle();
    expect(runs).toBe(2);
  });
});

describe("canApiCheck", () => {
  test("calls can-api /health; non-2xx fails", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response("{}", { status: 503 });
    }) as typeof fetch;
    await expect(canApiCheck(new AbortController().signal)).rejects.toThrow(
      "http 503",
    );
    expect(urls[0]).toEndWith("/health");
  });

  test("2xx passes; network error is unreachable", async () => {
    globalThis.fetch = (async (_input: string | URL | Request) =>
      new Response("{}")) as typeof fetch;
    await canApiCheck(new AbortController().signal);
    globalThis.fetch = (async (
      _input: string | URL | Request,
    ): Promise<Response> => {
      throw new TypeError("connect ECONNREFUSED 10.0.0.1:443");
    }) as typeof fetch;
    await expect(canApiCheck(new AbortController().signal)).rejects.toThrow(
      "unreachable",
    );
  });
});
