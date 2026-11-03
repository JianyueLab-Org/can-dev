import type { APIContext } from "astro";
import { afterEach, expect, test } from "bun:test";
import { requireSession } from "./guard";

afterEach(() => {
  delete process.env.PUBLIC_ORIGIN;
});

test("developer cookie mutations require configured Origin without blocking reads", () => {
  process.env.PUBLIC_ORIGIN = "https://configured.example";
  for (const method of [
    "GET",
    "HEAD",
    "OPTIONS",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
  ]) {
    for (const origin of [
      undefined,
      "null",
      "https://evil.ceruleanavi.net",
      "http://internal.test",
      "https://configured.example",
    ]) {
      const headers = new Headers();
      if (origin !== undefined) headers.set("origin", origin);
      const context = {
        request: new Request("http://internal.test/api/clients/app", {
          method,
          headers,
        }),
        locals: { session: { username: "10001", developer: true } },
      } as unknown as APIContext;
      const guarded = requireSession(context);
      const trusted =
        ["GET", "HEAD", "OPTIONS"].includes(method) ||
        origin === "https://configured.example";
      expect(guarded.ok).toBe(trusted);
      if (!guarded.ok) expect(guarded.response.status).toBe(403);
    }
  }
});
