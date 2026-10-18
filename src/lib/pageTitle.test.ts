import { describe, expect, test } from "bun:test";

import { pageTitle } from "./pageTitle";

describe("pageTitle", () => {
  test("页面 · 站名", () => {
    expect(pageTitle("地面图预览", "zh-cn")).toBe("地面图预览 · 开发者中心");
    expect(pageTitle("My apps", "en-us")).toBe("My apps · Developer Centre");
    expect(pageTitle("x", "zh-tw")).toBe("x · 開發者中心");
    expect(pageTitle("x", "ja-jp")).toBe("x · 開発者センター");
  });
  test("首页只有站名", () => {
    expect(pageTitle(undefined, "zh-cn")).toBe("开发者中心");
    expect(pageTitle("", "en-us")).toBe("Developer Centre");
  });
});
