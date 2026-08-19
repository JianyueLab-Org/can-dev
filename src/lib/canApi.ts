import crypto from "node:crypto";

import {
  SCOPES,
  apiOrigin,
  clientId,
  clientSecret,
  redirectUri,
  webOrigin,
} from "./config";

/**
 * 上游那一侧：授权、换令牌，以及调 `/api/v1/dev/clients`。
 *
 * 落在两个源上 —— 同意页在 can-web，其余全在 can-api。哪个用哪个见 config.ts。
 *
 * 这个文件是**唯一**知道 client_secret 的地方，而且它只在服务端跑。
 */

/* ------------------------------------------------------------------ *
 * PKCE + 授权
 * ------------------------------------------------------------------ */

/** RFC 7636 §4.1：43–128 个 unreserved 字符。32 字节 base64url 正好 43 个。 */
export function newVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function challengeFor(verifier: string): string {
  return crypto
    .createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
}

/**
 * 授权地址。
 *
 * 唯一还指向 can-web 的东西：同意页是渲染给人看的页面，带着主站的样式和会话，
 * 没有跟着数据层搬进 Go。
 *
 * PKCE 带上了，尽管开发者中心是机密客户端 —— 服务端对**所有**客户端强制 S256：
 * 授权码要经过浏览器地址栏，那里 client secret 保护不了任何东西。
 */
export function authorizeUrl(state: string, verifier: string): string {
  const url = new URL("/oauth/authorize", webOrigin());
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: redirectUri(),
    scope: SCOPES.join(" "),
    state,
    code_challenge: challengeFor(verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
}

/** 用授权码换令牌。密钥走 client_secret_post —— 请求体里，不进 URL。 */
export async function exchangeCode(
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const response = await fetch(new URL("/api/oauth/token", apiOrigin()), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: clientId(),
      client_secret: clientSecret(),
      code_verifier: verifier,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      `换令牌失败：${body.error ?? response.status} ${body.error_description ?? ""}`.trim(),
    );
  }
  return body as unknown as TokenResponse;
}

/**
 * 令牌代表的是谁。用 OIDC 的 userinfo，而不是自己解 id_token。
 *
 * `developer` 是 can-api 在 `profile` scope 下多给的一条非标准 claim：这个成员
 * 能不能用这个站。它放在 claim 里而不是另开一条接口，是因为登录流程本来就要打
 * 这一次 userinfo —— 多一次往返只为读一个布尔值不值得。
 *
 * **它是渲染依据，不是边界。** 真正把门的是 can-api 的 `withAppsManage`，那边
 * 每次请求都重读数据库那一列。这里读到的是登录那一刻的值，会随会话一起旧掉；
 * 旧掉的后果是菜单多显示了一条链接，而不是多了一次成功的写。
 *
 * 缺字段时按 `false` 算（`?? false`），而不是按 true。老版本 can-api 不送这条
 * claim，而在「不确定」和「放行」之间，这个站宁可让人看见一句解释。
 */
export async function userinfo(
  accessToken: string,
): Promise<{ sub: string; name?: string | null; developer: boolean }> {
  const response = await fetch(new URL("/api/oauth/userinfo", apiOrigin()), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`userinfo 失败：${response.status}`);
  const claims = (await response.json()) as {
    sub: string;
    name?: string | null;
    developer?: boolean;
  };
  return { ...claims, developer: claims.developer ?? false };
}

/* ------------------------------------------------------------------ *
 * 开发者 API
 * ------------------------------------------------------------------ */

export interface ManagedClient {
  id: string;
  name: string;
  isPublic: boolean;
  redirectUris: string[];
  scopes: string[];
  trusted: boolean;
  logoUrl: string | null;
  websiteUrl: string | null;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  activeTokens?: number;
  /** 只在创建和 rotate 的响应里出现，一次。 */
  clientSecret?: string | null;
}

export interface ApiFailure {
  ok: false;
  status: number;
  error: string;
  message: string;
}
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/**
 * 调 can-api 的开发者 API。
 *
 * 失败**不抛异常**，返回一个带 message 的失败对象：这些错误里绝大多数是成员
 * 填错了东西（回调地址不是 https、应用名像官方的），要原样显示在表单旁边，而
 * 不是变成一个 500 页面。真正的意外（网络断了）才抛。
 */
async function call<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const response = await fetch(new URL(path, apiOrigin()), {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: String(body.error ?? "http_error"),
      message: String(
        body.message ??
          body.error_description ??
          `请求失败（${response.status}）`,
      ),
    };
  }
  return { ok: true, data: body.data as T };
}

export const listClients = (token: string) =>
  call<ManagedClient[]>(token, "/api/v1/dev/clients");

export const createClient = (token: string, input: unknown) =>
  call<ManagedClient>(token, "/api/v1/dev/clients", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const updateClient = (token: string, id: string, patch: unknown) =>
  call<ManagedClient>(token, `/api/v1/dev/clients/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteClient = (token: string, id: string) =>
  call<{ deleted: boolean }>(
    token,
    `/api/v1/dev/clients/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );

export const rotateSecret = (token: string, id: string) =>
  call<{ clientSecret: string }>(
    token,
    `/api/v1/dev/clients/${encodeURIComponent(id)}/secret`,
    { method: "POST" },
  );
