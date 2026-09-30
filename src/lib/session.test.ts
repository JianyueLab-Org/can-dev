import { describe, expect, test } from "bun:test";

import { safeNext } from "./session";

describe("safeNext", () => {
  test("站内路径原样放行，查询串和锚点都留着", () => {
    expect(safeNext("/apps")).toBe("/apps");
    expect(safeNext("/docs/oauth?tab=pkce#scopes")).toBe(
      "/docs/oauth?tab=pkce#scopes",
    );
  });

  test("空值和非 / 开头一律回 /apps", () => {
    for (const value of [null, undefined, "", "apps", "https://evil.example"]) {
      expect(safeNext(value)).toBe("/apps");
    }
  });

  test("浏览器会解析到别的源的写法一律回 /apps", () => {
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r\n/evil.example",
    ]) {
      expect(safeNext(value)).toBe("/apps");
    }
  });
});
