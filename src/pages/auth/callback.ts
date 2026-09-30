import type { APIRoute } from "astro";
import crypto from "node:crypto";

import { exchangeCode, userinfo } from "@/lib/canApi";
import { NETWORK_SESSION_COOKIE } from "@/lib/networkSession";
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

  // 网络会话看不见时不发本站会话：中间件会立刻把它当孤儿清掉，登录会绕圈。
  if (!cookies.has(NETWORK_SESSION_COOKIE)) {
    return redirect("/?error=network_session_missing", 302);
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
      rating: who.rating,
    });

    // 不是开发者的人照样发会话。到 `/apps`、`/docs` 时中间件在原地址渲染
    // NoAccess（403），那一页报出他的 CAN ID。
    return redirect(safeNext(pending.next), 302);
  } catch {
    return redirect("/?error=exchange_failed", 302);
  }
};
