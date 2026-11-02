import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { PATCH } from "../pages/api/clients/[id]";
import { fakeCookies } from "./fakeCookies";
import { endDevSession, resolveDevSession } from "./networkSession";
import { writeSession, type Session } from "./session";

const SESSION: Session = {
  username: "1234",
  name: "Test Developer",
  accessToken: "test-token-a",
  expiresAt: Date.now() + 60 * 60 * 1000,
  developer: true,
  rating: 2,
};
const IDENTITY = {
  username: "1234",
  name: "Current Developer",
  email: "developer@example.com",
  rating: 5,
  aipAccess: 0,
  developer: true,
  emailVerified: true,
};
const realFetch = globalThis.fetch;
let checked = 0;
let mutations = 0;

function sealed(): string {
  const { cookies, jar } = fakeCookies();
  writeSession(cookies, SESSION);
  return jar.get("can_dev_session") as string;
}

function recorder() {
  const revoked: string[] = [];
  const revoke = async (token: string) => {
    revoked.push(token);
  };
  return { revoked, revoke };
}

function upstream(response: () => Response | Promise<Response>) {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/v1/auth/session") {
      checked++;
      // Identity must come from the network cookie, never from A's Bearer token.
      expect(new Headers(init.headers).get("cookie")).toBe(
        "can_session=network-cookie",
      );
      expect(new Headers(init.headers).has("authorization")).toBe(false);
      return response();
    }
    if (url.pathname.startsWith("/api/v1/dev/clients")) {
      mutations++;
      return Response.json({ data: { id: "test-app", name: "Updated" } });
    }
    throw new Error("Unexpected upstream request");
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.SESSION_SECRET = "network-session-test-secret";
  process.env.CAN_API_ORIGIN = "https://api.test";
  process.env.PUBLIC_ORIGIN = "https://platform.test";
  checked = 0;
  mutations = 0;
  upstream(() => Response.json({ user: IDENTITY }));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("resolveDevSession", () => {
  test("valid same-account session continues with current eligibility", async () => {
    const { cookies, deleted } = fakeCookies({
      can_dev_session: sealed(),
      can_session: "network-cookie",
    });
    const { revoked, revoke } = recorder();

    const session = await resolveDevSession(cookies, revoke);

    expect(session).toEqual({
      ...SESSION,
      name: "Current Developer",
      rating: 5,
    });
    expect(checked).toBe(1);
    expect(deleted).toEqual([]);
    expect(revoked).toEqual([]);
  });

  test.each([
    ["account switched to B", { ...IDENTITY, username: "5678" }],
    ["forged or nonexistent cookie", null],
    ["expired or revoked network session", null],
    ["missing identity fields", { username: "1234" }],
    ["invalid rating", { ...IDENTITY, rating: "5" }],
  ])(
    "%s clears A authority but preserves the network cookie",
    async (_, user) => {
      upstream(() => Response.json({ user }));
      const { cookies, deleted, jar } = fakeCookies({
        can_dev_session: sealed(),
        can_session: "network-cookie",
      });
      const { revoked, revoke } = recorder();

      expect(await resolveDevSession(cookies, revoke)).toBeNull();
      expect(deleted).toEqual(["can_dev_session"]);
      expect(revoked).toEqual(["test-token-a"]);
      expect(jar.get("can_session")).toBe("network-cookie");
    },
  );

  test.each(["transport failure", "HTTP failure", "malformed JSON"])(
    "%s cannot retain stale authority",
    async (failure) => {
      upstream(() => {
        if (failure === "transport failure") throw new Error("unreachable");
        return failure === "HTTP failure"
          ? Response.json({ user: IDENTITY }, { status: 503 })
          : new Response("not JSON");
      });
      const { cookies, deleted, jar } = fakeCookies({
        can_dev_session: sealed(),
        can_session: "network-cookie",
      });
      const { revoked, revoke } = recorder();

      expect(await resolveDevSession(cookies, revoke)).toBeNull();
      expect(deleted).toEqual(["can_dev_session"]);
      expect(revoked).toEqual(["test-token-a"]);
      expect(jar.has("can_session")).toBe(true);
    },
  );

  test("missing network cookie clears and revokes without an upstream call", async () => {
    const { cookies, deleted } = fakeCookies({ can_dev_session: sealed() });
    const { revoked, revoke } = recorder();

    expect(await resolveDevSession(cookies, revoke)).toBeNull();
    expect(deleted).toEqual(["can_dev_session"]);
    expect(revoked).toEqual(["test-token-a"]);
    expect(checked).toBe(0);
  });

  test("revocation does not delay rejection", async () => {
    const { cookies, deleted } = fakeCookies({ can_dev_session: sealed() });
    expect(
      await resolveDevSession(cookies, () => new Promise<void>(() => {})),
    ).toBeNull();
    expect(deleted).toEqual(["can_dev_session"]);
  });

  test("unreadable developer cookie is cleared without checking the network", async () => {
    const { cookies, deleted } = fakeCookies({
      can_dev_session: "garbage",
      can_session: "network-cookie",
    });
    const { revoked, revoke } = recorder();

    expect(await resolveDevSession(cookies, revoke)).toBeNull();
    expect(deleted).toEqual(["can_dev_session"]);
    expect(revoked).toEqual([]);
    expect(checked).toBe(0);
  });

  test("no developer cookie needs no network verification", async () => {
    const { cookies, deleted } = fakeCookies({ can_session: "network-cookie" });
    expect(await resolveDevSession(cookies)).toBeNull();
    expect(deleted).toEqual([]);
    expect(checked).toBe(0);
  });
});

describe("application mutation authorization", () => {
  test.each([
    "different account",
    "invalid session",
    "outage",
    "developer withdrawn",
  ])(
    "%s refuses a direct mutation without first visiting a developer page",
    async (state) => {
      upstream(() => {
        if (state === "outage") throw new Error("unreachable");
        return Response.json({
          user:
            state === "invalid session"
              ? null
              : {
                  ...IDENTITY,
                  username: state === "different account" ? "5678" : "1234",
                  developer: state !== "developer withdrawn",
                },
        });
      });
      const { cookies } = fakeCookies({
        can_dev_session: sealed(),
        can_session: "network-cookie",
      });
      const { revoke } = recorder();
      const session = await resolveDevSession(cookies, revoke);
      const response = await PATCH({
        cookies,
        locals: { session },
        params: { id: "test-app" },
        request: new Request("https://platform.test/api/clients/test-app", {
          method: "PATCH",
          headers: { origin: "https://platform.test" },
          body: JSON.stringify({ name: "Updated" }),
        }),
      } as unknown as APIContext);

      expect(response.status).toBe(state === "developer withdrawn" ? 403 : 401);
      expect(mutations).toBe(0);
    },
  );

  test("valid same-account developer can still update an application", async () => {
    const { cookies } = fakeCookies({
      can_dev_session: sealed(),
      can_session: "network-cookie",
    });
    const response = await PATCH({
      cookies,
      locals: { session: await resolveDevSession(cookies) },
      params: { id: "test-app" },
      request: new Request("https://platform.test/api/clients/test-app", {
        method: "PATCH",
        headers: { origin: "https://platform.test" },
        body: JSON.stringify({ name: "Updated" }),
      }),
    } as unknown as APIContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { id: "test-app", name: "Updated" },
    });
    expect(mutations).toBe(1);
  });
});

describe("endDevSession", () => {
  test("clears the developer session and revokes its token", async () => {
    const { cookies, deleted } = fakeCookies({ can_dev_session: sealed() });
    const { revoked, revoke } = recorder();
    await endDevSession(cookies, revoke);
    expect(deleted).toEqual(["can_dev_session"]);
    expect(revoked).toEqual(["test-token-a"]);
  });

  test("clears an absent session without revoking", async () => {
    const { cookies, deleted } = fakeCookies();
    const { revoked, revoke } = recorder();
    await endDevSession(cookies, revoke);
    expect(deleted).toEqual(["can_dev_session"]);
    expect(revoked).toEqual([]);
  });
});
