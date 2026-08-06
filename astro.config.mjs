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
  vite: { plugins: [tailwindcss()] },
});
