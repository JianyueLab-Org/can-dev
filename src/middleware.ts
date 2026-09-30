import { defineMiddleware } from "astro:middleware";

import { resolveDevSession } from "@/lib/networkSession";

/**
 * 会话解析 + 路由保护 + 安全响应头。
 *
 * 会话在这里解一次，挂到 `locals.session` 上。带 `can_dev_session` 却没有
 * `can_session` 的请求，本站会话在这里被清掉、令牌被吊销
 * （`lib/networkSession.ts`）。
 *
 * `/api/*` 不在保护范围里：那些路由自己检查会话（`requireSession`）。
 *
 * `/apps`、`/docs` 要登录并且是开发者。首页和 `/ground` 不要：首页说明这个站
 * 并给出登录入口，`/ground` 没有上游。can-ui 的站点注册表指首页，两处一起看。
 *
 * 登录了但不是开发者：改写到 `/no-access`，地址不变，渲染 `NoAccess`，403。
 * 这道判断读会话里的缓存，是门面，不是边界。边界是 can-api 的
 * `/api/v1/dev/clients`，每次请求都重读 `user.developer`。
 */
const PROTECTED = ["/apps", "/docs"];

function withSecurityHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const session = resolveDevSession(context.cookies);
  context.locals.session = session;

  const path = context.url.pathname;
  const guarded = PROTECTED.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

  if (guarded && !session) {
    return withSecurityHeaders(
      context.redirect(`/auth/login?next=${encodeURIComponent(path)}`, 302),
    );
  }

  // `=== true`：旧会话里这一位是 undefined，按「不是」处理。
  if (guarded && session && session.developer !== true) {
    context.locals.noAccess = true;
    return withSecurityHeaders(await next("/no-access"));
  }

  return withSecurityHeaders(await next());
});
