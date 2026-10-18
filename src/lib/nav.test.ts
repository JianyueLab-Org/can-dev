import { describe, expect, test } from "bun:test";

import { devNav, isProtectedPath } from "./nav";

describe("isProtectedPath", () => {
  test("要登录的路径", () => {
    for (const p of ["/apps", "/apps/", "/apps/x", "/docs", "/docs/"]) {
      expect(isProtectedPath(p)).toBe(true);
    }
  });
  test("公开的路径", () => {
    for (const p of ["/", "/ground", "/appsx", "/docsx", "/no-access"]) {
      expect(isProtectedPath(p)).toBe(false);
    }
  });
});

describe("devNav", () => {
  test("顺序和链接按规格，四项都在", () => {
    const nav = devNav((key) => key);
    expect(nav.map((i) => [i.name, i.href, i.icon])).toEqual([
      ["nav.home", "/", "home"],
      ["nav.ground", "/ground", "map"],
      ["nav.apps", "/apps", "squaresPlus"],
      ["nav.docs", "/docs", "commandLine"],
    ]);
  });
});
