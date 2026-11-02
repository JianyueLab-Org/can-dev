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
 * 每次使用本站会话前向 can-api 核实网络身份，必须与令牌所属成员一致。
 * 无法核实时清本站 cookie，后台吊销令牌；不改网络 cookie 或第三方令牌。
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

export interface NetworkMember {
  username: string;
  name: string;
  developer: boolean;
  rating: number;
}

/** 网络 cookie 只交给 can-api 验证，不在本站解码或信任其存在。 */
export async function readNetworkMember(
  cookies: AstroCookies,
): Promise<NetworkMember | null> {
  const cookie = cookies.get(NETWORK_SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const response = await fetch(new URL("/api/v1/auth/session", apiOrigin()), {
      headers: { Cookie: `${NETWORK_SESSION_COOKIE}=${cookie}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("user" in body)) return null;
    const user = body.user;
    if (
      !user ||
      typeof user !== "object" ||
      !("username" in user) ||
      typeof user.username !== "string" ||
      !user.username ||
      !("name" in user) ||
      typeof user.name !== "string" ||
      !("developer" in user) ||
      typeof user.developer !== "boolean" ||
      !("rating" in user) ||
      typeof user.rating !== "number" ||
      !Number.isInteger(user.rating)
    ) {
      return null;
    }
    return {
      username: user.username,
      name: user.name,
      developer: user.developer,
      rating: user.rating,
    };
  } catch {
    return null;
  }
}

/**
 * 每个请求只验证一次，后续页面和 API 路由共用 locals.session。
 * 缺失、失效、换号或上游不可用时都不接受旧令牌。
 * 开发者资格与评级取当前网络身份；是否可管理应用仍由 can-api 复核。
 */
export async function resolveDevSession(
  cookies: AstroCookies,
  revoke: Revoke = revokeToken,
): Promise<Session | null> {
  if (!cookies.has(SESSION_COOKIE)) return null;
  const session = readSession(cookies);
  const member = session ? await readNetworkMember(cookies) : null;
  if (session && member && member.username === session.username) {
    return {
      ...session,
      name: member.name,
      developer: member.developer,
      rating: member.rating,
    };
  }

  clearSession(cookies);
  if (session) void revoke(session.accessToken);
  return null;
}
