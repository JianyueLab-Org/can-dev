<script setup lang="ts">
/**
 * 开发者中心的外壳：can-ui `CanFrame`，`content` 布局。
 *
 * 品牌是方形标记 + 站名。「我的应用」只在登录后出现。登录走本站的 OAuth PKCE
 * （`/auth/login`）。退出由 `AccountMenu` 发 `POST /api/v1/auth/signout`，
 * 之后原地刷新。
 */
import { computed } from "vue";
import {
  CanFrame,
  originsFromEnv,
  type FrameUser,
  type NavItem,
} from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";

const props = withDefaults(
  defineProps<{
    /** `frame` 命名空间，加上 `nav`（`dev.nav`）和 `siteName`。 */
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

const nav = computed<NavItem[]>(() => {
  const items: NavItem[] = [{ name: t("nav.home"), href: "/", icon: "home" }];
  if (props.user) {
    items.push({ name: t("nav.apps"), href: "/apps", icon: "squares2x2" });
  }
  items.push(
    { name: t("nav.docs"), href: "/docs", icon: "bookOpen" },
    { name: t("nav.ground"), href: "/ground", icon: "map" },
  );
  return items;
});
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
    after-sign-out="reload"
    :messages="messages"
    :origins="origins"
  >
    <template #brand>
      <span class="flex items-center gap-2.5">
        <img alt="" src="/logo.png" class="h-8 w-auto" />
        <span class="text-sm font-semibold text-ink">{{ t("siteName") }}</span>
      </span>
    </template>
    <slot />
  </CanFrame>
</template>
