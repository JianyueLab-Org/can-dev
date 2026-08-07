/**
 * 环境。全部在服务端读，一个都不带 `PUBLIC_` 前缀 —— 这里没有任何一项是浏览
 * 器该看见的（`PUBLIC_ORIGIN` 是个例外的名字，但它也只在服务端用来拼回调地址）。
 *
 * 缺配置就抛，而且是在**第一次用到的时候**抛，不是在模块加载的时候。构建期
 * 会 import 到这个模块，而构建机上没有 client_secret。
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `缺少环境变量 ${name}。开发者中心跑不起来，见 .env.example。`,
    );
  }
  return value;
}

/**
 * 上游是**两个**地址，这是数据层搬进 can-api 之后必然的结果。
 *
 * `CAN_API_ORIGIN` 是 OIDC 的 issuer，也是除同意页以外所有东西的去处：换令牌、
 * userinfo、吊销，以及 `/api/v1/dev/clients`。
 *
 * `CAN_WEB_ORIGIN` 只剩一件事 —— 同意页 `/oauth/authorize`。它没有跟着数据层
 * 搬走，因为它是一个要渲染给人看、带着主站样式和会话的**页面**，不是一个端点。
 * RFC 8414 允许 discovery 里的 authorization_endpoint 落在别的源上，can-api
 * 的 discovery 文档正是这么写的（issuer 是它自己，authorization_endpoint 指回
 * can-web），所以这不是配错了。
 *
 * 两者共用同一个数据库：授权码由 can-web 写进 `oauthCode`，由 can-api 兑换。
 *
 * 旧的 `CAN_ISSUER` 没有保留。它当时同时表示这两件事，而现在这两件事是两个地
 * 址 —— 留着它只会让人以为改一个值就够了。
 */
export const apiOrigin = () =>
  (process.env.CAN_API_ORIGIN || "https://api.airwaysn.org").replace(
    /\/+$/,
    "",
  );

export const webOrigin = () =>
  (process.env.CAN_WEB_ORIGIN || "https://airwaysn.org").replace(/\/+$/, "");

/** 这个部署自己的对外地址，回调地址就是从它拼出来的。 */
export const origin = () =>
  (process.env.PUBLIC_ORIGIN || "http://127.0.0.1:4322").replace(/\/+$/, "");

export const clientId = () => process.env.CAN_CLIENT_ID || "can-dev";
export const clientSecret = () => required("CAN_CLIENT_SECRET");
export const sessionSecret = () => required("SESSION_SECRET");

export const redirectUri = () => `${origin()}/auth/callback`;

/**
 * 开发者中心要的 scope。
 *
 * `openid` 认人，`profile` 拿来在右上角显示名字，`apps:manage` 才是它真正来
 * 要的东西。**没有 `offline_access`** —— 这是有意的：刷新令牌意味着这个站点
 * 在成员关掉浏览器之后还能继续动他名下的应用，而开发者中心是个坐下来用的地
 * 方，会话跟着浏览器走就够了。少一种长期凭据，就少一种会泄露的东西。
 */
export const SCOPES = ["openid", "profile", "apps:manage"] as const;
