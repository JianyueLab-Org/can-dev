/**
 * 页面标题：`<页面> · <站名>`。站名是 can-ui 的 `siteLabel(locale, "dev").name`，
 * 和网络菜单里写的一样。首页不带页面名，只有站名。
 */
import { siteLabel } from "@jianyuelab-org/can-ui/sites";

export function pageTitle(page: string | undefined, locale: string): string {
  const site = siteLabel(locale, "dev").name;
  return page ? `${page} · ${site}` : site;
}
