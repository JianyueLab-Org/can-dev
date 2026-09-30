import type { AstroCookies } from "astro";

import { apiOrigin, clientId } from "./config";
import {
  SESSION_COOKIE,
  clearSession,
  readSession,
  type Session,
} from "./session";

/**
 * 本站会话和网络会话的关系。
 *
 * `can_session` 是 can-api 写在父域 `.ceruleanavi.net` 上的网络会话，这个站
 * 看得见。`can_dev_session` 是本站的，装着本站的 OAuth 访问令牌。
 *
 * 网络会话没了（在任何一个站退出），本站会话跟着走：吊销令牌，清 cookie。
 * 第三方应用的令牌不在这里，网络退出不吊销它们。
 */
export const NETWORK_SESSION_COOKIE = "can_session";

const REVOKE_TIMEOUT_MS = 5000;

export type Revoke = (accessToken: string) => Promise<void>;

/** 吊销本站的访问令牌。失败不抛：退出不能因为上游卡住而卡住。 */
export async function revokeToken(accessToken: string): Promise<void> {
  try {
    await fetch(new URL("/api/oauth/revoke", apiOrigin()), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: accessToken,
        token_type_hint: "access_token",
        client_id: clientId(),
        client_secret: process.env.CAN_CLIENT_SECRET || "",
      }),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
  } catch {
    // 令牌最多再活一小时。
  }
}

/** 退出本站：清 cookie，有令牌就吊销。 */
export async function endDevSession(
  cookies: AstroCookies,
  revoke: Revoke = revokeToken,
): Promise<void> {
  const session = readSession(cookies);
  clearSession(cookies);
  if (session) await revoke(session.accessToken);
}

/**
 * 中间件读会话用这一个。
 *
 * 带 `can_dev_session` 却没有 `can_session`：清掉本站会话，后台吊销令牌，
 * 返回 null。吊销不等：`revokeToken` 不抛，页面不必为它多等 5 秒。
 */
export function resolveDevSession(
  cookies: AstroCookies,
  revoke: Revoke = revokeToken,
): Session | null {
  if (!cookies.has(SESSION_COOKIE)) return null;
  if (cookies.has(NETWORK_SESSION_COOKIE)) return readSession(cookies);

  const orphan = readSession(cookies);
  clearSession(cookies);
  if (orphan) void revoke(orphan.accessToken);
  return null;
}
