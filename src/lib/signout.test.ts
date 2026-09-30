import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { POST } from "../pages/api/v1/auth/signout";
import { fakeCookies } from "./fakeCookies";
import { writeSession } from "./session";

/**
 * 钉住 `POST /api/v1/auth/signout`：can-ui 的 AccountMenu 发到这里。
 *
 * 顺序：Origin 检查 → 吊销本站令牌、清 `can_dev_session` → 转发 can-api，原样
 * 带回它的 `Set-Cookie`。测试文件不放在 `src/pages/` 下：那里每个 `.ts` 都是路由。
 */

const ORIGIN = "https://platform.ceruleanavi.net";
const API = "https://api.test";
const CLEARED =
  "can_session=; Path=/; Domain=.ceruleanavi.net; Max-Age=0; HttpOnly; Secure; SameSite=Lax";

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }> = [];

function stubFetch(signout: () => Response | Promise<Response>): void {
  calls = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    if (url === `${API}/api/oauth/revoke`) {
      return new Response(null, { status: 200 });
    }
    if (url === `${API}/api/v1/auth/signout`) return signout();
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

function sealedSession(): string {
  const { cookies, jar } = fakeCookies();
  writeSession(cookies, {
    username: "1234",
    name: "Li",
    accessToken: "tok-1",
    expiresAt: Date.now() + 60 * 60 * 1000,
    developer: true,
  });
  return jar.get("can_dev_session") as string;
}

function context(headers: Record<string, string>, jar: Record<string, string>) {
  const fake = fakeCookies(jar);
  const ctx = {
    request: new Request(`${ORIGIN}/api/v1/auth/signout`, {
      method: "POST",
      headers,
    }),
    cookies: fake.cookies,
  } as unknown as APIContext;
  return { ctx, ...fake };
}

function upstreamOk(): Response {
  return new Response('{"ok":true}', {
    status: 200,
    headers: [
      ["content-type", "application/json"],
      ["set-cookie", CLEARED],
    ],
  });
}

beforeEach(() => {
  process.env.PUBLIC_ORIGIN = ORIGIN;
  process.env.CAN_API_ORIGIN = API;
  process.env.SESSION_SECRET = "signout-test-secret";
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("POST /api/v1/auth/signout", () => {
  test("跨站请求 403，不清 cookie，不发任何请求", async () => {
    stubFetch(upstreamOk);
    const { ctx, deleted } = context(
      { origin: "https://evil.example" },
      { can_dev_session: sealedSession(), can_session: "net" },
    );

    const response = await POST(ctx);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "bad_origin" });
    expect(deleted).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("本站请求：吊销、清会话、转发，带回 can-api 的 Set-Cookie", async () => {
    stubFetch(upstreamOk);
    const { ctx, deleted } = context(
      { origin: ORIGIN },
      { can_dev_session: sealedSession(), can_session: "net-token" },
    );

    const response = await POST(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([CLEARED]);
    expect(deleted).toEqual(["can_dev_session"]);

    expect(calls.map((c) => c.url)).toEqual([
      `${API}/api/oauth/revoke`,
      `${API}/api/v1/auth/signout`,
    ]);
    const revokeBody = new URLSearchParams(String(calls[0].init.body));
    expect(revokeBody.get("token")).toBe("tok-1");

    const forwarded = calls[1].init.headers as Record<string, string>;
    expect(forwarded.cookie).toBe("can_session=net-token");
    expect(calls[1].init.method).toBe("POST");
  });

  test("不带 Origin 头的调用方放行", async () => {
    stubFetch(upstreamOk);
    const { ctx, deleted } = context({}, { can_dev_session: sealedSession() });

    const response = await POST(ctx);

    expect(response.status).toBe(200);
    expect(deleted).toEqual(["can_dev_session"]);
  });

  test("没有本站会话：不吊销，照样转发", async () => {
    stubFetch(upstreamOk);
    const { ctx } = context({ origin: ORIGIN }, { can_session: "net-token" });

    const response = await POST(ctx);

    expect(response.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual([`${API}/api/v1/auth/signout`]);
  });

  test("can-api 不响应：502，本站会话照样清掉", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const { ctx, deleted } = context(
      { origin: ORIGIN },
      { can_dev_session: sealedSession(), can_session: "net-token" },
    );

    const response = await POST(ctx);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "upstream_unreachable",
    });
    expect(deleted).toEqual(["can_dev_session"]);
  });
});
