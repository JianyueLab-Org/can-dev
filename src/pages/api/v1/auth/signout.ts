import type { APIRoute } from "astro";

import { apiOrigin, origin } from "@/lib/config";
import { NETWORK_SESSION_COOKIE, endDevSession } from "@/lib/networkSession";

/**
 * 网络退出。can-ui 的 `AccountMenu` 同源 POST 到这里。
 *
 * 1. Origin 检查，在清 cookie 之前。比对显式的 `PUBLIC_ORIGIN`，不带 Origin
 *    头的放行 —— 和 `lib/guard.ts` 同一判法。
 * 2. 吊销本站令牌，清 `can_dev_session`。
 * 3. 转发 can-api 的 `/api/v1/auth/signout`，只带 `can_session`，原样返回它的
 *    状态、响应体和每一条 `Set-Cookie`。
 */
const TIMEOUT_MS = 5000;
const NO_STORE = { "cache-control": "no-store, private" };

export const POST: APIRoute = async ({ cookies, request }) => {
  const sent = request.headers.get("origin");
  if (sent && sent !== origin()) {
    return Response.json(
      { error: "bad_origin", message: "跨站请求被拒绝。" },
      { status: 403, headers: NO_STORE },
    );
  }

  await endDevSession(cookies);

  const headers: Record<string, string> = { accept: "application/json" };
  const network = cookies.get(NETWORK_SESSION_COOKIE)?.value;
  if (network) {
    headers.cookie = `${NETWORK_SESSION_COOKIE}=${encodeURIComponent(network)}`;
  }

  let upstream: Response;
  try {
    upstream = await fetch(new URL("/api/v1/auth/signout", apiOrigin()), {
      method: "POST",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return Response.json(
      { error: "upstream_unreachable" },
      { status: 502, headers: NO_STORE },
    );
  }

  const out = new Headers();
  out.set("cache-control", "no-store, private");
  const type = upstream.headers.get("content-type");
  if (type) out.set("content-type", type);
  for (const value of upstream.headers.getSetCookie()) {
    out.append("set-cookie", value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
};
