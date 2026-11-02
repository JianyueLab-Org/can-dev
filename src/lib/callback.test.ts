import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { GET } from "../pages/auth/callback";
import { fakeCookies } from "./fakeCookies";
import { readSession, writePending, writeSession } from "./session";

/**
 * OAuth 回调必须把已验证的网络身份与 userinfo 的令牌主体绑定。
 * 测试文件不放在 `src/pages/` 下：那里每个 `.ts` 都是路由。
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
  process.env.CAN_API_ORIGIN = "https://api.test";
  process.env.CAN_CLIENT_SECRET = "callback-test-client-secret";
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

describe("callback identity binding", () => {
  function oauth(networkUser: unknown, subject = "1234") {
    const revoked: string[] = [];
    globalThis.fetch = (async (input, init = {}) => {
      fetched++;
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/auth/session") {
        return Response.json({ user: networkUser });
      }
      if (url.pathname === "/api/oauth/token") {
        return Response.json({
          access_token: "new-test-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (url.pathname === "/api/oauth/userinfo") {
        return Response.json({
          sub: subject,
          name: "OAuth Snapshot",
          developer: true,
          rating: 2,
        });
      }
      if (url.pathname === "/api/oauth/revoke") {
        revoked.push(new URLSearchParams(String(init.body)).get("token") ?? "");
        return new Response(null, { status: 200 });
      }
      throw new Error("Unexpected upstream request");
    }) as typeof fetch;
    return revoked;
  }

  const member = {
    username: "1234",
    name: "Current Member",
    email: "member@example.com",
    rating: 5,
    aipAccess: 0,
    developer: true,
    emailVerified: true,
  };

  test("account switched before callback does not receive A's developer session", async () => {
    const revoked = oauth({ ...member, username: "5678" });
    const { ctx, jar } = context({
      can_dev_pending: pendingCookie(),
      can_session: "network-cookie",
    });

    const response = await GET(ctx);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/?error=network_session_mismatch",
    );
    expect(jar.has("can_dev_session")).toBe(false);
    expect(jar.get("can_session")).toBe("network-cookie");
    expect(revoked).toEqual(["new-test-token"]);
  });

  test("invalid network session cannot issue a developer token", async () => {
    oauth(null);
    const { ctx, jar } = context({
      can_dev_pending: pendingCookie(),
      can_session: "network-cookie",
    });

    const response = await GET(ctx);

    expect(response.headers.get("location")).toBe(
      "/?error=network_session_missing",
    );
    expect(jar.has("can_dev_session")).toBe(false);
    expect(fetched).toBe(1);
  });

  test("verification outage does not issue a developer session", async () => {
    const { ctx, jar } = context({
      can_dev_pending: pendingCookie(),
      can_session: "network-cookie",
    });

    const response = await GET(ctx);

    expect(response.headers.get("location")).toBe(
      "/?error=network_session_missing",
    );
    expect(jar.has("can_dev_session")).toBe(false);
  });

  test("same-account OAuth continues with current network eligibility", async () => {
    oauth({ ...member, developer: false });
    const { ctx } = context({
      can_dev_pending: pendingCookie(),
      can_session: "network-cookie",
    });

    const response = await GET(ctx);

    expect(response.headers.get("location")).toBe("/apps");
    expect(readSession(ctx.cookies)).toMatchObject({
      username: "1234",
      name: "Current Member",
      accessToken: "new-test-token",
      developer: false,
      rating: 5,
    });
    expect(fetched).toBe(3);
  });
});

test("invalid callback network identity clears and revokes the previous developer session", async () => {
  const { ctx, jar, deleted } = context({
    can_dev_pending: pendingCookie(),
    can_session: "network-cookie",
  });
  writeSession(ctx.cookies, {
    username: "1234",
    name: "Previous Developer",
    accessToken: "previous-test-token",
    expiresAt: Date.now() + 3600000,
    developer: true,
    rating: 2,
  });
  const revoked: string[] = [];
  globalThis.fetch = (async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/oauth/revoke") {
      revoked.push(new URLSearchParams(String(init.body)).get("token") ?? "");
      return new Response(null, { status: 200 });
    }
    if (path === "/api/v1/auth/session") return Response.json({ user: null });
    throw new Error("Unexpected upstream request");
  }) as typeof fetch;

  const response = await GET(ctx);

  expect(response.headers.get("location")).toBe(
    "/?error=network_session_missing",
  );
  expect(jar.has("can_dev_session")).toBe(false);
  expect(jar.get("can_session")).toBe("network-cookie");
  expect(deleted).toContain("can_dev_session");
  expect(revoked).toEqual(["previous-test-token"]);
});
