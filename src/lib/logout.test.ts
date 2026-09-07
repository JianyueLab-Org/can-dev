import type { APIContext } from "astro";
import { beforeEach, describe, expect, test } from "bun:test";

import { POST } from "../pages/auth/logout";

/**
 * 钉住 `/auth/logout` 的 Origin 检查。
 *
 * 这条路由是这个站里唯一一条**不经过 `requireSession()`** 的写操作，
 * `astro.config.mjs` 关掉 `checkOrigin` 时点名的也是它 —— 然后检查一直没有补
 * 回来。这组测试就是那个「补回来了」的凭据。
 *
 * 为什么值得一颗钉子：它错了**屏幕上什么都看不出来**。登出在自己站上照常工作，
 * 坏的是别人站上一个隐藏表单能把访客登出，而那件事只有受害者会遇到，且他多半
 * 以为是自己的会话过期了。
 *
 * 测试文件放在 `lib/` 而不是挨着被测的路由：`src/pages/` 下的每一个 `.ts` 都
 * 是一条路由，一个 `logout.test.ts` 会变成 `/auth/logout.test`。
 */

/** 这次部署自己的地址。`origin()` 每次调用都重读它，所以在测试里设就够了。 */
const ORIGIN = "https://platform.ceruleanavi.net";

/** 记下 `cookies.delete` 有没有被调用 —— 那一步就是「把人登出」本身。 */
function fakeContext(headers: Record<string, string>) {
  const deleted: string[] = [];
  const redirects: Array<{ path: string; status?: number }> = [];

  const context = {
    request: new Request(`${ORIGIN}/auth/logout`, { method: "POST", headers }),
    cookies: {
      // 没有会话 cookie：于是 `readSession` 直接返回 null，吊销那一段被跳过，
      // 也就不会有任何网络请求。**而 `clearSession` 是无条件执行的** —— 那正
      // 是这个漏洞的关键，所以它也是这里要观察的东西。
      get: () => undefined,
      set: () => {},
      delete: (name: string) => deleted.push(name),
    },
    redirect: (path: string, status?: number) => {
      redirects.push({ path, status });
      return new Response(null, {
        status: status ?? 302,
        headers: { location: path },
      });
    },
  } as unknown as APIContext;

  return { context, deleted, redirects };
}

describe("POST /auth/logout", () => {
  beforeEach(() => {
    process.env.PUBLIC_ORIGIN = ORIGIN;
  });

  test("跨站的表单 POST 被拒，而且**没有**清掉会话 cookie", async () => {
    const { context, deleted } = fakeContext({
      origin: "https://evil.example",
    });

    const response = await POST(context);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "bad_origin" });
    // 要紧的一条：响应里不能带删除会话的 Set-Cookie。修好之前，`clearSession`
    // 在读会话之前就跑了，于是一个人只是访问了别人的网页就被登出。
    expect(deleted).toEqual([]);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("本站自己的表单 POST 照常登出", async () => {
    const { context, deleted, redirects } = fakeContext({ origin: ORIGIN });

    const response = await POST(context);

    expect(response.status).toBe(302);
    expect(redirects).toEqual([{ path: "/", status: 302 }]);
    expect(deleted).toEqual(["can_dev_session"]);
  });

  test("不带 Origin 头的调用方放行", async () => {
    // curl、以及不发这个头的老浏览器。拒绝它挡不住任何东西 —— 攻击面是浏览器
    // 里的跨站表单，而那种请求**一定**带 Origin。判法和 `lib/guard.ts` 一致。
    const { context, deleted } = fakeContext({});

    const response = await POST(context);

    expect(response.status).toBe(302);
    expect(deleted).toEqual(["can_dev_session"]);
  });

  test("Origin 只差一个端口也算跨站", async () => {
    const { context, deleted } = fakeContext({
      origin: "https://platform.ceruleanavi.net:8443",
    });

    const response = await POST(context);

    expect(response.status).toBe(403);
    expect(deleted).toEqual([]);
  });
});
