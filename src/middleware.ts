import { defineMiddleware } from "astro:middleware";

import { isProtectedPath } from "@/lib/nav";
import { resolveDevSession } from "@/lib/networkSession";

/**
 * 会话解析 + 路由保护 + 安全响应头。
 *
 * 会话在这里解一次，并验证网络身份，挂到 `locals.session` 上。
 * 网络身份缺失、失效、换号或无法核实时，清本站会话并后台吊销令牌。
 * OAuth 回调自己验证身份和发放会话，不消费旧会话。
 *
 * `/api/*` 不在保护范围里：那些路由自己检查会话（`requireSession`）。
 *
 * `/apps`、`/docs` 要登录并且是开发者。首页和 `/ground` 不要：首页说明这个站
 * 并给出登录入口，`/ground` 没有上游。can-ui 的站点注册表指首页，两处一起看。
 * 名单在 `lib/nav.ts`，导航和退出去向读同一份。
 *
 * 登录了但不是开发者：改写到 `/no-access`，地址不变，渲染 `NoAccess`，403。
 * 开发者资格来自当前网络身份。can-api 的 `/api/v1/dev/clients`
 * 仍独立检查令牌、开发者资格和应用所有权。
 */
function withSecurityHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const session =
    context.url.pathname === "/auth/callback"
      ? null
      : await resolveDevSession(context.cookies);
  context.locals.session = session;

  const path = context.url.pathname;
  const guarded = isProtectedPath(path);

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
