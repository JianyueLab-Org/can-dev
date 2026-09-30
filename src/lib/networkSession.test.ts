import { beforeAll, describe, expect, test } from "bun:test";

import { fakeCookies } from "./fakeCookies";
import { endDevSession, resolveDevSession } from "./networkSession";
import { writeSession, type Session } from "./session";

/**
 * 网络会话没了，本站会话跟着走。
 *
 * 在别的站退出只清掉父域上的 `can_session`。`can_dev_session` 是本站自己的，
 * 没有这条规则它会一直活到令牌过期。
 */

const SESSION: Session = {
  username: "1234",
  name: "Li",
  accessToken: "tok-1",
  expiresAt: Date.now() + 60 * 60 * 1000,
  developer: true,
  rating: 2,
};

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

beforeAll(() => {
  process.env.SESSION_SECRET = "network-session-test-secret";
});

describe("resolveDevSession", () => {
  test("两个 cookie 都在：返回会话，什么都不动", () => {
    const { cookies, deleted } = fakeCookies({
      can_dev_session: sealed(),
      can_session: "net",
    });
    const { revoked, revoke } = recorder();

    const session = resolveDevSession(cookies, revoke);

    expect(session?.username).toBe("1234");
    expect(deleted).toEqual([]);
    expect(revoked).toEqual([]);
  });

  test("有 can_dev_session 没有 can_session：清掉并吊销", () => {
    const { cookies, deleted } = fakeCookies({ can_dev_session: sealed() });
    const { revoked, revoke } = recorder();

    const session = resolveDevSession(cookies, revoke);

    expect(session).toBeNull();
    expect(deleted).toEqual(["can_dev_session"]);
    expect(revoked).toEqual(["tok-1"]);
  });

  test("解不开的 can_dev_session、没有 can_session：清掉，不吊销", () => {
    const { cookies, deleted } = fakeCookies({ can_dev_session: "garbage" });
    const { revoked, revoke } = recorder();

    expect(resolveDevSession(cookies, revoke)).toBeNull();
    expect(deleted).toEqual(["can_dev_session"]);
    expect(revoked).toEqual([]);
  });

  test("没有 can_dev_session：返回 null，什么都不动", () => {
    const { cookies, deleted } = fakeCookies({ can_session: "net" });
    const { revoked, revoke } = recorder();

    expect(resolveDevSession(cookies, revoke)).toBeNull();
    expect(deleted).toEqual([]);
    expect(revoked).toEqual([]);
  });
});

describe("endDevSession", () => {
  test("清掉会话，吊销令牌", async () => {
    const { cookies, deleted } = fakeCookies({ can_dev_session: sealed() });
    const { revoked, revoke } = recorder();

    await endDevSession(cookies, revoke);

    expect(deleted).toEqual(["can_dev_session"]);
    expect(revoked).toEqual(["tok-1"]);
  });

  test("没有会话：照样清，不吊销", async () => {
    const { cookies, deleted } = fakeCookies();
    const { revoked, revoke } = recorder();

    await endDevSession(cookies, revoke);

    expect(deleted).toEqual(["can_dev_session"]);
    expect(revoked).toEqual([]);
  });
});
