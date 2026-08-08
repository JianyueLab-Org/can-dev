// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vue from "@astrojs/vue";
import tailwindcss from "@tailwindcss/vite";

/**
 * 开发者中心。和 can-web 同一套形状：Astro SSR（standalone Node 适配器）+
 * Vue 岛屿 + Tailwind v4。
 *
 * `output: "server"` 不是可选项 —— 这个站点的每一个页面都要先知道「你是谁」，
 * 而访问令牌只存在于服务端的会话 cookie 里，任何一个预渲染的页面都拿不到它。
 */
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [vue()],

  /**
   * **必须关掉，否则这个站的每一个 POST 都是 403。**
   *
   * Astro 在 SSR 下默认开启 `checkOrigin`：它从 `Host` 头推导出本站的 origin，
   * 再和浏览器发来的 `Origin` 头比对，对不上就 403。而这个站跑在 TLS 终止的反
   * 代后面 —— Astro 推出来的是 `http://platform.airwaysn.org`，浏览器发的是
   * `https://…`，**永远对不上**。can-web 因为同一个原因早就关掉了它。
   *
   * 关掉不等于没有检查：写操作的 Origin 由 `src/lib/guard.ts` 比对**显式的**
   * `PUBLIC_ORIGIN` 来判，那个值不是从请求头推的，所以反代动不了它。
   *
   * 这一条缺席时最先撞上的是登出（`/auth/logout` 是 POST，而且它上面没有守卫，
   * 所以 403 看着毫无来由）。
   */
  security: { checkOrigin: false },

  vite: { plugins: [tailwindcss()] },
});
