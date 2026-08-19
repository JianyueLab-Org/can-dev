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
 *
 * ## 为什么 `/docs` 在这里
 *
 * 接口文档从前是公开的。它现在要登录 —— 读它的人是来注册应用的，而注册应用本
 * 来就需要一个成员账号，所以这道门槛不挡任何真正要用它的人。
 *
 * **首页不在这个名单里，这是有意的，而且它是这次改动的另一半。** 一个未登录的
 * 访客仍然要有一页能说明这个站是什么、并把他送去登录 —— 否则「开发者中心」在全
 * 网菜单里就成了一条谁也点不动的链接。can-ui 的站点注册表因此把这一条从
 * `/docs` 改指首页；两处要一起看，只改一边会让菜单指向登录墙（改回 `/docs`）或
 * 者让文档重新暴露（从这里拿掉）。
 *
 * `/ground` 同理留在外面，理由写在 `Header.vue` 的导航里：它没有上游，文件是使
 * 用者自己拖进浏览器的。
 *
 * ## 登录之外还有一道：开发者
 *
 * `user.developer` 上线之后，这两条路径要的不只是「登录了」，而是「登录了、并且
 * 是开发者」。不是的人被送去 `/no-access`，那一页解释怎么申请 —— 而不是送去登录
 * 页，因为他已经登录了，再让他登一次只会转圈。
 *
 * **这道判断是门面，不是边界。** 它读的是会话 cookie 里那份缓存（见
 * `lib/session.ts`），最多旧一小时；真正的边界在 can-api，`/api/v1/dev/clients`
 * 每次请求都重读数据库。所以一个刚被撤销的人可能还看得见 `/apps` 的骨架，但那
 * 一页拉不到任何数据，本站的 `/api/clients/*` 也会 403（见 `lib/guard.ts`）。
 * 拿掉这里不会让任何东西泄漏，只会让人看见一个 403 而不是一句解释。
 */
const PROTECTED = ["/apps", "/docs"];

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

  // 登录了，但不是开发者。`=== true` 而不是取反：这一位在旧会话里是 undefined，
  // 而「读不出来」必须和「false」走同一条路。
  if (guarded && session && session.developer !== true) {
    return withSecurityHeaders(context.redirect("/no-access", 302));
  }

  return withSecurityHeaders(await next());
});
