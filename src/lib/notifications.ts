import type { APIContext } from "astro";

import { apiOrigin, origin } from "./config";
import { NETWORK_SESSION_COOKIE } from "./networkSession";

/**
 * 通知铃的转发：can-ui `NotificationBell` 同源调的五条，原样转给 can-api 的
 * `/api/v1/notifications…`。
 *
 * - 路径按 `ROUTES` 收紧，表外 404，方法不对 405。
 * - 写操作查 Origin，比对 `PUBLIC_ORIGIN`，不带 Origin 头的放行 —— 和
 *   `signout.ts`、`guard.ts` 同一判法。
 * - 只带 `can_session`。这几条在 can-api 上只认 cookie，本站令牌不给它。
 * - 原样带回状态、响应体和每一条 `Set-Cookie`，一律 no-store。
 */

/** `rest` 是 `/api/v1/notifications` 之后的部分，不带前导斜杠。 */
const ROUTES: ReadonlyArray<{ test: RegExp; methods: readonly string[] }> = [
  { test: /^$/, methods: ["GET"] },
  { test: /^unread$/, methods: ["GET"] },
  { test: /^read-all$/, methods: ["POST"] },
  { test: /^(member|broadcast)\/[0-9]{1,20}$/, methods: ["PATCH"] },
];

export type NotificationMatch =
  | { ok: true; path: string }
  | { ok: false; status: 404 }
  | { ok: false; status: 405; allow: string };

export function matchNotificationRoute(
  rest: string | undefined,
  method: string,
): NotificationMatch {
  const tail = rest ?? "";
  const route = ROUTES.find((entry) => entry.test.test(tail));
  if (!route) return { ok: false, status: 404 };
  if (!route.methods.includes(method.toUpperCase())) {
    return { ok: false, status: 405, allow: route.methods.join(", ") };
  }
  return {
    ok: true,
    path: tail ? `/api/v1/notifications/${tail}` : "/api/v1/notifications",
  };
}

const TIMEOUT_MS = 8000;
/** `{"read":true}` 是最大的一次合法请求体。 */
const MAX_BODY_BYTES = 1024;
const NO_STORE = { "cache-control": "no-store, private" };

export async function handleNotifications(
  context: Pick<APIContext, "cookies" | "request" | "params" | "url">,
): Promise<Response> {
  const { cookies, request } = context;
  const method = request.method.toUpperCase();
  const match = matchNotificationRoute(context.params.path, method);
  if (!match.ok) {
    if (match.status === 404) {
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: NO_STORE },
      );
    }
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { ...NO_STORE, allow: match.allow } },
    );
  }

  if (method !== "GET") {
    const sent = request.headers.get("origin");
    if (sent && sent !== origin()) {
      return Response.json(
        { error: "bad_origin", message: "跨站请求被拒绝。" },
        { status: 403, headers: NO_STORE },
      );
    }
  }

  let body: string | undefined;
  if (method !== "GET") {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return Response.json(
        { error: "too_large" },
        { status: 413, headers: NO_STORE },
      );
    }
    if (text) body = text;
  }

  const headers: Record<string, string> = { accept: "application/json" };
  const network = cookies.get(NETWORK_SESSION_COOKIE)?.value;
  if (network) {
    headers.cookie = `${NETWORK_SESSION_COOKIE}=${encodeURIComponent(network)}`;
  }
  if (body !== undefined) headers["content-type"] = "application/json";

  let upstream: Response;
  try {
    upstream = await fetch(
      new URL(match.path + context.url.search, apiOrigin()),
      {
        method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    return Response.json(
      { error: "upstream_unreachable" },
      { status: 502, headers: NO_STORE },
    );
  }

  const out = new Headers(NO_STORE);
  const type = upstream.headers.get("content-type");
  if (type) out.set("content-type", type);
  for (const value of upstream.headers.getSetCookie()) {
    out.append("set-cookie", value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
