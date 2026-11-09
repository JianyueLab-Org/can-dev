import { apiOrigin } from "./config";

/**
 * `GET /health`：给外部可用性监控看的。k8s 探针不指这里 —— 上游故障不该重启 Pod。
 *
 * - 每项检查 3 秒超时；结果在进程内缓存 10 秒，刷新期间并发请求共用一次检查。
 * - 全部通过 200 `{"status":"ok","checks":{…}}`，任一失败 503 `"status":"fail"`，
 *   失败项写简短原因，不带地址或凭据。
 * - 一律 `cache-control: no-store`。
 */

export type HealthCheck = (signal: AbortSignal) => Promise<void>;

export const CHECK_TIMEOUT_MS = 3000;
export const CACHE_TTL_MS = 10_000;
const NO_STORE = { "cache-control": "no-store" };

type Result = {
  ok: boolean;
  body: { status: "ok" | "fail"; checks: Record<string, string> };
};

function reason(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return "timeout";
  if (error instanceof Error && error.message) return error.message;
  return "failed";
}

async function runOne(check: HealthCheck, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const { promise: timeout, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    controller.abort();
    reject(new Error("timeout"));
  }, timeoutMs);
  try {
    await Promise.race([check(controller.signal), timeout]);
    return "ok";
  } catch (error) {
    return reason(error, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function createHealthHandler(
  checks: Record<string, HealthCheck>,
  opts: { ttlMs?: number; timeoutMs?: number; now?: () => number } = {},
): () => Promise<Response> {
  const ttlMs = opts.ttlMs ?? CACHE_TTL_MS;
  const timeoutMs = opts.timeoutMs ?? CHECK_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  let cached: { result: Result; at: number } | undefined;
  let inflight: Promise<Result> | undefined;

  async function evaluate(): Promise<Result> {
    const names = Object.keys(checks);
    const outcomes = await Promise.all(
      names.map((name) => runOne(checks[name], timeoutMs)),
    );
    const body: Result["body"] = { status: "ok", checks: {} };
    names.forEach((name, i) => {
      body.checks[name] = outcomes[i];
      if (outcomes[i] !== "ok") body.status = "fail";
    });
    if (body.status === "fail") {
      console.warn(`health check failed: ${JSON.stringify(body.checks)}`);
    }
    return { ok: body.status === "ok", body };
  }

  return async () => {
    let result: Result;
    if (cached && now() - cached.at < ttlMs) {
      result = cached.result;
    } else {
      inflight ??= evaluate().finally(() => {
        inflight = undefined;
      });
      result = await inflight;
      cached = { result, at: now() };
    }
    return Response.json(result.body, {
      status: result.ok ? 200 : 503,
      headers: NO_STORE,
    });
  };
}

/** can-api 的 `/health`，非 2xx 算失败。 */
export const canApiCheck: HealthCheck = async (signal) => {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}/health`, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new Error("timeout");
    throw new Error("unreachable", { cause: error });
  }
  await response.body?.cancel();
  if (response.status < 200 || response.status > 299) {
    throw new Error(`http ${response.status}`);
  }
};

export const handleHealth = createHealthHandler({ "can-api": canApiCheck });
