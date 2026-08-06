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

/** can-web 的地址，也就是 OIDC 的 issuer。 */
export const issuer = () =>
  (process.env.CAN_ISSUER || "https://airwaysn.org").replace(/\/+$/, "");

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
