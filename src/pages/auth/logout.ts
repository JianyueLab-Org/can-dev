import type { APIRoute } from "astro";

import { clearSession, readSession } from "@/lib/session";
import { issuer } from "@/lib/config";

/**
 * 退出。
 *
 * 两件事，缺一不可：清掉本地会话，**并且**把访问令牌拿去 can-web 吊销。只清
 * cookie 的话，那个令牌在它剩下的寿命里仍然是有效的 —— 而它能管理这个成员名
 * 下的所有应用。令牌是不透明的、每次使用都查库，所以吊销是立刻生效的。
 *
 * 吊销失败不挡退出：本地会话该清还是要清，用户按了退出就得退出。
 *
 * POST 而不是 GET —— 一个 GET 就能退出的地址，别人往页面里塞一个 <img> 就能
 * 把你踢下线。
 */
export const POST: APIRoute = async ({ cookies, redirect }) => {
  const session = readSession(cookies);
  clearSession(cookies);

  if (session) {
    try {
      await fetch(new URL("/api/oauth/revoke", issuer()), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: session.accessToken,
          token_type_hint: "access_token",
          client_id: process.env.CAN_CLIENT_ID || "can-dev",
          client_secret: process.env.CAN_CLIENT_SECRET || "",
        }),
      });
    } catch {
      // 网络问题不该把人卡在登录状态里。令牌最多再活一小时。
    }
  }

  return redirect("/", 302);
};
