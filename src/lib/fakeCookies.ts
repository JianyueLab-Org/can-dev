import type { AstroCookies } from "astro";

/**
 * A cookie jar for tests. Implements the four `AstroCookies` methods this
 * site calls: `get`, `has`, `set`, `delete`.
 */
export function fakeCookies(initial: Record<string, string> = {}): {
  cookies: AstroCookies;
  jar: Map<string, string>;
  deleted: string[];
} {
  const jar = new Map(Object.entries(initial));
  const deleted: string[] = [];
  const cookies = {
    get: (name: string) =>
      jar.has(name) ? { value: jar.get(name) as string } : undefined,
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
      deleted.push(name);
    },
  } as unknown as AstroCookies;
  return { cookies, jar, deleted };
}
