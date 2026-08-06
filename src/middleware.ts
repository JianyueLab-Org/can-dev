import { defineMiddleware } from "astro:middleware";

import { readSession } from "@/lib/session";

/**
 * 会话解析 + 路由保护 + 安全响应头。形状照抄 can-web 的 middleware.ts。
 *
 * 会话在这里解一次，挂到 `locals.session` 上，页面和 API 路由都从那里读 ——
 * 一个请求解一次 cookie，而不是每个用到的地方各解一次。
 *
 * **`/api/*` 不在保护范围里**，和 can-web 一样：那些路由自己检查会话（见
 * `requireSession`）。中间件重定向到登录页对一个 fetch 调用是没有意义的，它
 * 需要的是 401。
 */
const PROTECTED = ["/apps"];

function withSecurityHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const session = readSession(context.cookies);
  context.locals.session = session;

  const path = context.url.pathname;
  const guarded = PROTECTED.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );

  if (guarded && !session) {
    // 早返回的重定向也要过安全头 —— 它不会落到下面的 next() 那条路上。
    return withSecurityHeaders(
      context.redirect(`/auth/login?next=${encodeURIComponent(path)}`, 302),
    );
  }

  return withSecurityHeaders(await next());
});
