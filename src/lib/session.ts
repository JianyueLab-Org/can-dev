import crypto from "node:crypto";
import type { AstroCookies } from "astro";

import { sessionSecret } from "./config";

/**
 * 会话：一个加密的 cookie，里面装着访问令牌。
 *
 * **令牌绝不能到浏览器里去。** 页面上的 Vue 岛屿要改应用时调的是本站自己的
 * `/api/clients/*`，那些路由在服务端把 cookie 解开、拿出令牌、再去问 can-web。
 * 如果令牌直接发给浏览器，那么开发者中心的任何一处 XSS 都等于把「管理这个成
 * 员名下所有应用」的能力交出去，而这些应用的回调地址是可以改的。
 *
 * 用 AES-256-GCM 而不是签名（JWT 那种）：这里面装的是**凭据**，不是断言。签
 * 名只保证没被改过，任何人拿到 cookie 都能读出令牌；加密之后，即使 cookie 从
 * 日志或者浏览器备份里漏出去，没有 SESSION_SECRET 也用不了。
 *
 * `PENDING` 是登录中途那一小段：PKCE 的 verifier 和 state 得在跳去 can-web 之
 * 前存下来，回来的时候比对。它和会话分开放，因为它的生命周期只有一次跳转。
 */

const SESSION_COOKIE = "can_dev_session";
const PENDING_COOKIE = "can_dev_pending";

export interface Session {
  /** ASN ID。 */
  username: string;
  name: string | null;
  accessToken: string;
  /** epoch 毫秒。到点就当没登录，而不是拿一个必然被拒的令牌去打一次 API。 */
  expiresAt: number;
}

export interface Pending {
  state: string;
  verifier: string;
  /** 登录前想去的地方，登录完跳回去。只收站内路径。 */
  next: string;
}

/** SESSION_SECRET 派生出的 32 字节 key。密钥本身长度不定，哈希一次取齐。 */
function key(): Buffer {
  return crypto.createHash("sha256").update(sessionSecret(), "utf8").digest();
}

function seal(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), body]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function open<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map((part) => Buffer.from(part, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(body),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plain) as T;
  } catch {
    // 解不开 = 伪造的、过期密钥签的、或者被截断了。一律当作没登录。
    return null;
  }
}

const base = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  // 开发机上是 http://127.0.0.1，那里 secure cookie 存不下来。
  secure: process.env.NODE_ENV === "production",
};

export function readSession(cookies: AstroCookies): Session | null {
  const session = open<Session>(cookies.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  if (!session.expiresAt || session.expiresAt <= Date.now()) return null;
  return session;
}

export function writeSession(cookies: AstroCookies, session: Session): void {
  cookies.set(SESSION_COOKIE, seal(session), {
    ...base,
    // cookie 的寿命跟着令牌走，不多给一秒。
    expires: new Date(session.expiresAt),
  });
}

export function clearSession(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

export function writePending(cookies: AstroCookies, pending: Pending): void {
  cookies.set(PENDING_COOKIE, seal(pending), { ...base, maxAge: 10 * 60 });
}

export function takePending(cookies: AstroCookies): Pending | null {
  const pending = open<Pending>(cookies.get(PENDING_COOKIE)?.value);
  // 一次性的：无论成不成，读完就删，免得一个用过的 state 还能再用一次。
  cookies.delete(PENDING_COOKIE, { path: "/" });
  return pending;
}

/**
 * 登录后要跳回哪里。
 *
 * 只接受以单个 `/` 开头的站内路径。`//evil.example` 在浏览器里是**协议相对
 * 的绝对地址**，放过去就是一个开放重定向 —— 而这条路径的终点正好是「刚登录
 * 完、带着会话」的那一刻。
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//"))
    return "/apps";
  return value;
}
