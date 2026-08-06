import type { APIContext } from "astro";

import { origin } from "./config";
import type { Session } from "./session";

/**
 * 本站 `/api/*` 的门。
 *
 * 两道，分别挡两件不同的事：
 *
 * 1. **有没有会话。** 没有就 401，而不是重定向 —— 调用方是页面里的 fetch，它
 *    要的是一个能判断的状态码。
 *
 * 2. **写操作的 Origin。** 会话 cookie 是 SameSite=Lax，跨站的表单 POST 带不
 *    上它；但这道检查不白做：Lax 对**顶层导航**的 GET 是放行的，而且一旦将来
 *    有人把某个写操作改成 GET，或者浏览器的 Lax 语义再变一次，这里是唯一还站
 *    着的东西。用显式的 `PUBLIC_ORIGIN` 比对，而不是 Astro 的 `checkOrigin`：
 *    这个站跑在 TLS 终止的反代后面，Astro 从 Host 头推出来的 origin 是
 *    `http://…`，和浏览器发来的 `https://…` 永远对不上（can-web 的
 *    astro.config.mjs 里关掉那个检查就是这个原因）。
 */
const UNSAFE = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export type Guarded =
  | { ok: true; session: Session }
  | { ok: false; response: Response };

export function requireSession(context: APIContext): Guarded {
  const session = context.locals.session;
  if (!session) {
    return {
      ok: false,
      response: Response.json(
        { error: "unauthorized", message: "请先登录。" },
        { status: 401 },
      ),
    };
  }

  if (UNSAFE.has(context.request.method)) {
    const sent = context.request.headers.get("origin");
    if (sent && sent !== origin()) {
      return {
        ok: false,
        response: Response.json(
          { error: "bad_origin", message: "跨站请求被拒绝。" },
          { status: 403 },
        ),
      };
    }
  }

  return { ok: true, session };
}

/** can-web 的失败原样传下去，状态码也一并保留。 */
export function relay(result: {
  status: number;
  error: string;
  message: string;
}): Response {
  return Response.json(
    { error: result.error, message: result.message },
    { status: result.status },
  );
}
