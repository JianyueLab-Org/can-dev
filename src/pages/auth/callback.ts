import type { APIRoute } from "astro";
import crypto from "node:crypto";

import { exchangeCode, userinfo } from "@/lib/canApi";
import { safeNext, takePending, writeSession } from "@/lib/session";

/**
 * can-web 跳回来的落点。
 *
 * 顺序是有讲究的：**先比 state，再拿授权码去换**。反过来写的话，一个攻击者
 * 塞进来的授权码会先被兑换掉（在 can-web 那边留下一次使用记录，还会把他的账
 * 号和这个浏览器绑上），然后我们才发现 state 对不上。
 *
 * state 用定时安全比较。它不是密钥，但这是一个逐字符比较能被计时区分的地方，
 * 而写成安全比较不花什么力气。
 */
export const GET: APIRoute = async ({ cookies, url, redirect }) => {
  const pending = takePending(cookies);
  const error = url.searchParams.get("error");
  if (error) {
    const description = url.searchParams.get("error_description") || "";
    return redirect(
      `/?error=${encodeURIComponent(error)}&detail=${encodeURIComponent(description)}`,
      302,
    );
  }

  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!pending || !code) return redirect("/?error=missing_state", 302);

  const expected = Buffer.from(pending.state);
  const received = Buffer.from(state);
  if (
    expected.length !== received.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
    return redirect("/?error=state_mismatch", 302);
  }

  try {
    const tokens = await exchangeCode(code, pending.verifier);
    const who = await userinfo(tokens.access_token);

    writeSession(cookies, {
      username: who.sub,
      name: who.name ?? null,
      accessToken: tokens.access_token,
      // 比令牌自己早 30 秒过期：一个「刚好还没过期」的令牌发出去，会在
      // can-web 那边变成 401，而这里表现为一次莫名其妙的失败。
      expiresAt: Date.now() + Math.max(0, tokens.expires_in - 30) * 1000,
      developer: who.developer,
    });

    // 不是开发者的人**照样发会话**，然后送去 /no-access。
    //
    // 直接拒绝登录看着更干脆，代价是那一页只能说「你不能用这个站」，说不出
    // 「你是 1234，去找管理员报这个号」—— 而后者正是他接下来要做的事。会话在
    // 这里也确实没有别的用处：can-api 会拒掉每一次调用。
    if (!who.developer) return redirect("/no-access", 302);

    return redirect(safeNext(pending.next), 302);
  } catch {
    return redirect("/?error=exchange_failed", 302);
  }
};
