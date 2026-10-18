/**
 * 本站导航和要登录的路径。中间件和外壳读同一份。
 *
 * 导航四项不论登没登录都显示。`/apps`、`/docs` 要登录：未登录点进去，中间件
 * 送去 `/auth/login`。
 */
import type { NavItem } from "@jianyuelab-org/can-ui/nav";

export const PROTECTED_PREFIXES: readonly string[] = ["/apps", "/docs"];

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** 图标和 can-ui `sitePages.ts` 的 dev 条目一致。 */
export function devNav(t: (key: string) => string): NavItem[] {
  return [
    { name: t("nav.home"), href: "/", icon: "home" },
    { name: t("nav.ground"), href: "/ground", icon: "map" },
    { name: t("nav.apps"), href: "/apps", icon: "squaresPlus" },
    { name: t("nav.docs"), href: "/docs", icon: "commandLine" },
  ];
}
