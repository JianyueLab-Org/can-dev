import type { APIRoute } from "astro";

import { clearSession, readSession } from "@/lib/session";
import { apiOrigin, origin } from "@/lib/config";

/**
 * 上游最多等这么久。
 *
 * 吊销失败不挡退出（见下面），所以这里等的每一秒都是纯粹的浪费 —— 一个不响应
 * 的 can-api 会把「点了退出但页面不动」变成这个站唯一一个卡死的动作。5 秒和
 * `lib/canApi.ts` 里那三条一致。
 */
const REVOKE_TIMEOUT_MS = 5000;

/**
 * 退出。
 *
 * 两件事，缺一不可：清掉本地会话，**并且**把访问令牌拿去 can-api 吊销。只清
 * cookie 的话，那个令牌在它剩下的寿命里仍然是有效的 —— 而它能管理这个成员名
 * 下的所有应用。令牌是不透明的、每次使用都查库，所以吊销是立刻生效的。
 *
 * 吊销失败不挡退出：本地会话该清还是要清，用户按了退出就得退出。
 *
 * POST 而不是 GET —— 一个 GET 就能退出的地址，别人往页面里塞一个 <img> 就能
 * 把你踢下线。
 */
export const POST: APIRoute = async ({ cookies, redirect, request }) => {
  /**
   * 写操作的 Origin 检查，**必须在 `clearSession` 之前**。
   *
   * `astro.config.mjs` 里关掉 `checkOrigin` 时点名的就是这条路由（它上面没有
   * 别的守卫，所以那个 403 看着毫无来由），但关掉之后**没有把检查补回来** ——
   * 于是这个站里唯一一条既是写操作、又不经过 `requireSession()` 的路由，成了
   * 唯一一条谁都能从站外触发的。
   *
   * 「会话 cookie 是 SameSite=Lax，跨站表单 POST 带不上它」挡不住这一条：带不
   * 上 cookie 只意味着 `readSession` 读到 null、吊销那一段被跳过，而
   * `clearSession(cookies)` 是**无条件**执行的 —— 响应照样带着删除 cookie 的
   * `Set-Cookie`，于是一个人只是访问了别人的一张网页，就被登出了。跨站表单
   * POST 不触发预检，所以没有任何一层会先问一句。
   *
   * 判法和 `lib/guard.ts` 里那一条逐字一致：比对**显式配置**的
   * `PUBLIC_ORIGIN`（反代推不出来的那个值），并且**放行不带 Origin 头的请求**
   * —— 非浏览器的调用方本来就不带，拒绝它只会打到正常调用，挡不住任何东西。
   */
  const sent = request.headers.get("origin");
  if (sent && sent !== origin()) {
    return Response.json(
      { error: "bad_origin", message: "跨站请求被拒绝。" },
      { status: 403 },
    );
  }

  const session = readSession(cookies);
  clearSession(cookies);

  if (session) {
    try {
      await fetch(new URL("/api/oauth/revoke", apiOrigin()), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: session.accessToken,
          token_type_hint: "access_token",
          client_id: process.env.CAN_CLIENT_ID || "can-dev",
          client_secret: process.env.CAN_CLIENT_SECRET || "",
        }),
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      });
    } catch {
      // 网络问题、或者上游超时不响应，都不该把人卡在登录状态里。令牌最多再活
      // 一小时。
    }
  }

  return redirect("/", 302);
};
