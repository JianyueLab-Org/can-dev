import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { fakeCookies } from "./fakeCookies";
import { handleNotifications, matchNotificationRoute } from "./notifications";

/**
 * 通知铃的转发：`/api/v1/notifications/[...path]` 的全部逻辑。
 * 只带 `can_session`，不带本站会话。测试不放在 `src/pages/` 下：那里每个
 * `.ts` 都是路由。
 */

const ORIGIN = "https://platform.ceruleanavi.net";
const API = "https://api.test";

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }> = [];

function stub(respond: () => Response): void {
  calls = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      init,
    });
    return respond();
  }) as typeof fetch;
}

function context(
  method: string,
  path: string | undefined,
  opts: {
    origin?: string;
    jar?: Record<string, string>;
    body?: string;
    search?: string;
  } = {},
) {
  const url = new URL(
    `${ORIGIN}/api/v1/notifications${path ? `/${path}` : ""}${opts.search ?? ""}`,
  );
  const headers: Record<string, string> = {};
  if (opts.origin) headers.origin = opts.origin;
  if (opts.body) headers["content-type"] = "application/json";
  return {
    request: new Request(url, { method, headers, body: opts.body }),
    url,
    params: { path },
    cookies: fakeCookies(opts.jar ?? {}).cookies,
  } as unknown as APIContext;
}

beforeEach(() => {
  process.env.PUBLIC_ORIGIN = ORIGIN;
  process.env.CAN_API_ORIGIN = API;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("matchNotificationRoute", () => {
  test("五条路径各自的方法", () => {
    const cases: Array<[string | undefined, string, string]> = [
      [undefined, "GET", "/api/v1/notifications"],
      ["", "GET", "/api/v1/notifications"],
      ["unread", "GET", "/api/v1/notifications/unread"],
      ["read-all", "POST", "/api/v1/notifications/read-all"],
      ["member/1", "PATCH", "/api/v1/notifications/member/1"],
      ["broadcast/42", "patch", "/api/v1/notifications/broadcast/42"],
    ];
    for (const [path, method, upstream] of cases) {
      expect(matchNotificationRoute(path, method)).toEqual({
        ok: true,
        path: upstream,
      });
    }
  });

  test.each([
    "member",
    "member/abc",
    "member/1/read",
    "other/1",
    "broadcast/123456789012345678901",
    "unread/x",
    "../auth/signout",
  ])("%s 是 404", (path) => {
    expect(matchNotificationRoute(path, "GET")).toEqual({
      ok: false,
      status: 404,
    });
  });

  test("方法不对是 405，带 Allow", () => {
    expect(matchNotificationRoute("member/1", "GET")).toEqual({
      ok: false,
      status: 405,
      allow: "PATCH",
    });
  });
});

describe("handleNotifications", () => {
  test("只带 can_session，不带本站会话；no-store", async () => {
    stub(() => Response.json({ count: 2 }));
    const response = await handleNotifications(
      context("GET", "unread", {
        jar: { can_session: "net-token", can_dev_session: "sealed" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 2 });
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(calls.map((c) => c.url)).toEqual([
      `${API}/api/v1/notifications/unread`,
    ]);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.cookie).toBe("can_session=net-token");
  });

  test("列表：查询串原样带过去", async () => {
    stub(() => Response.json({ items: [], next: null }));
    await handleNotifications(
      context("GET", undefined, {
        jar: { can_session: "net-token" },
        search: "?before=abc&limit=20",
      }),
    );
    expect(calls[0].url).toBe(
      `${API}/api/v1/notifications?before=abc&limit=20`,
    );
  });

  test("标记一条：body 过去，204 回来，Set-Cookie 带回", async () => {
    stub(
      () =>
        new Response(null, {
          status: 204,
          headers: [["set-cookie", "can_session=renewed; Path=/"]],
        }),
    );
    const response = await handleNotifications(
      context("PATCH", "broadcast/9", {
        origin: ORIGIN,
        jar: { can_session: "net-token" },
        body: '{"read":true}',
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([
      "can_session=renewed; Path=/",
    ]);
    expect(calls[0].init.method).toBe("PATCH");
    expect(calls[0].init.body).toBe('{"read":true}');
  });

  test("全部已读：没有 body 也转发", async () => {
    stub(() => new Response(null, { status: 204 }));
    const response = await handleNotifications(
      context("POST", "read-all", {
        origin: ORIGIN,
        jar: { can_session: "net-token" },
      }),
    );
    expect(response.status).toBe(204);
    expect(calls[0].init.body).toBeUndefined();
  });

  test("跨站写 403，不问上游", async () => {
    stub(() => new Response(null, { status: 204 }));
    const response = await handleNotifications(
      context("POST", "read-all", {
        origin: "https://evil.example",
        jar: { can_session: "net-token" },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "bad_origin" });
    expect(calls).toEqual([]);
  });

  test("表外 404、方法不对 405，都不问上游", async () => {
    stub(() => Response.json({}));
    expect(
      (await handleNotifications(context("PATCH", "member/abc"))).status,
    ).toBe(404);
    const wrong = await handleNotifications(context("GET", "read-all"));
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("POST");
    expect(calls).toEqual([]);
  });

  test("没有 can_session：照样问，上游的 401 原样回来", async () => {
    stub(() => Response.json({ error: "unauthorized" }, { status: 401 }));
    const response = await handleNotifications(context("GET", "unread"));
    expect(response.status).toBe(401);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.cookie).toBeUndefined();
  });

  test("上游不响应：502", async () => {
    calls = [];
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const response = await handleNotifications(
      context("GET", "unread", { jar: { can_session: "net-token" } }),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "upstream_unreachable",
    });
  });
});
