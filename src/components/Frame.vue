<script setup lang="ts">
/**
 * 开发者中心的外壳：can-ui `CanFrame`，`content` 布局。
 *
 * 导航四项不论登没登录都显示（`lib/nav.ts`）。登录走本站的 OAuth PKCE
 * （`/auth/login`）。退出由 `AccountMenu` 发 `POST /api/v1/auth/signout`：
 * 公开页原地刷新，要登录的页回主站首页。
 */
import {
  CanFrame,
  originsFromEnv,
  type AfterSignOut,
  type FrameUser,
} from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";
import { devNav, isProtectedPath } from "@/lib/nav";

const props = withDefaults(
  defineProps<{
    /** `frame` 命名空间，加上 `nav`（`dev.nav`）。 */
    messages: Record<string, unknown>;
    locale: string;
    pathname: string;
    user?: FrameUser | null;
    /** 登录入口，带上当前页，登录后回到这一页。 */
    signInHref: string;
  }>(),
  { user: null },
);

const t = createTranslator(props.messages);
const origins = originsFromEnv(import.meta.env);

const nav = devNav(t);
const afterSignOut: AfterSignOut = isProtectedPath(props.pathname)
  ? "web"
  : "reload";
</script>

<template>
  <CanFrame
    layout="content"
    current="dev"
    :locale="locale"
    :pathname="pathname"
    :nav="nav"
    :user="user"
    notifications
    :sign-in-href="signInHref"
    :after-sign-out="afterSignOut"
    :messages="messages"
    :origins="origins"
  >
    <slot />
  </CanFrame>
</template>
