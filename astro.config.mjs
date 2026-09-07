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
   * 代后面 —— Astro 推出来的是 `http://platform.ceruleanavi.net`，浏览器发的是
   * `https://…`，**永远对不上**。can-web 因为同一个原因早就关掉了它。
   *
   * 关掉不等于没有检查：写操作的 Origin 由 `src/lib/guard.ts` 比对**显式的**
   * `PUBLIC_ORIGIN` 来判，那个值不是从请求头推的，所以反代动不了它。
   *
   * 这一条缺席时最先撞上的是登出（`/auth/logout` 是 POST，而当时它上面没有守
   * 卫，所以 403 看着毫无来由）。
   *
   * **那条路由现在自己带着检查了。** 关掉 `checkOrigin` 却没有把它补回来，曾
   * 经让登出成为这个站里唯一一条谁都能从站外触发的写操作：跨站表单 POST 不触
   * 发预检，SameSite=Lax 只挡住 cookie（于是吊销那一段被跳过），而清 cookie
   * 那一步是无条件的 —— 响应照样带着删除会话的 Set-Cookie。见
   * `src/pages/auth/logout.ts` 顶上那段。
   */
  security: { checkOrigin: false },

  vite: {
    plugins: [tailwindcss()],

    /**
     * can-ui 发的是**源码**（`.vue` / `.ts` / `.css`）而不是构建产物 —— 六个
     * 站是同一套 Astro + Vue + Tailwind v4 工具链，包里再压一个编译步骤只会
     * 碍事。代价是必须告诉 Vite 不要把它当外部依赖：不加这一行，SSR 会去
     * `require` 一个 `.vue` 文件，首屏直接 500。
     */
    ssr: { noExternal: ["@jianyuelab-org/can-ui"] },
  },
});
