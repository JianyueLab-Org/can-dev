import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { GET } from "../pages/auth/callback";
import { fakeCookies } from "./fakeCookies";
import { writePending } from "./session";

/**
 * 回调不在没有 `can_session` 时发本站会话：中间件会立刻把它当孤儿清掉，登录
 * 会绕圈。测试文件不放在 `src/pages/` 下：那里每个 `.ts` 都是路由。
 */

const realFetch = globalThis.fetch;
let fetched = 0;

function context(jar: Record<string, string>) {
  const fake = fakeCookies(jar);
  const ctx = {
    cookies: fake.cookies,
    url: new URL("https://platform.test/auth/callback?state=s1&code=c1"),
    redirect: (location: string, status = 302) =>
      new Response(null, { status, headers: { location } }),
  } as unknown as APIContext;
  return { ctx, ...fake };
}

function pendingCookie(): string {
  const { cookies, jar } = fakeCookies();
  writePending(cookies, { state: "s1", verifier: "v", next: "/apps" });
  return [...jar.values()][0];
}

beforeEach(() => {
  process.env.SESSION_SECRET = "callback-test-secret";
  fetched = 0;
  globalThis.fetch = (async () => {
    fetched++;
    throw new Error("unexpected fetch");
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("GET /auth/callback", () => {
  test("没有 can_session：跳回首页报错，不换码，不写会话", async () => {
    const { ctx, jar } = context({ can_dev_pending: pendingCookie() });

    const response = await GET(ctx);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/?error=network_session_missing",
    );
    expect(fetched).toBe(0);
    expect(jar.has("can_dev_session")).toBe(false);
  });
});
