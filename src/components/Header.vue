<script setup lang="ts">
/**
 * 站头 —— can-ui `SiteHeader` 外面一层。
 *
 * 外形、抽屉、「全网」菜单都来自 can-ui，和主站、考试中心、雷达是同一份实现。
 * 留在这里的是开发者中心自己的内容：
 *
 * - **品牌是方形标记 + 站名**，不是 `<Logo>` 那幅字标。字标里写的是网络的名
 *   字，挂在这儿站头就成了「网络名 + 站名」并排，同一个名字说了两遍。文字用词
 *   条，所以它跟着语言走。
 * - **「我的应用」只在登录后出现。** 匿名访客点它会被中间件弹到 `/auth/login`
 *   —— 一个点了就把你送走的导航项，不如不列。
 * - **退出是一个 POST 表单**（`/auth/logout`），不是 `@signout`：会话 cookie 是
 *   本站自己加密的，清它的是本站的路由，而表单在水合之前也按得动。
 */
import { computed } from "vue";
import {
  SiteHeader,
  type NavChild,
  type SiteOrigins,
} from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";

const props = withDefaults(
  defineProps<{
    /** `header` 和 `dev` 两个命名空间合成的字典，见 SiteLayout。 */
    messages: Record<string, unknown>;
    /** 登录了就有，用来在右上角显示名字。 */
    memberName?: string | null;
    /** 会话评级，只喂给「全网」菜单。不是权限判断。 */
    rating?: number;
    pathname?: string;
    locale?: string;
    /** 开发环境的站点地址覆盖，见 SiteLayout。 */
    origins?: SiteOrigins;
  }>(),
  {
    memberName: null,
    rating: undefined,
    pathname: "",
    locale: "zh-cn",
    origins: undefined,
  },
);

const t = createTranslator(props.messages);
const loggedIn = computed(() => !!props.memberName);

const navigation = computed<NavChild[]>(() => [
  { name: t("dev.nav.home"), href: "/" },
  ...(loggedIn.value ? [{ name: t("dev.nav.apps"), href: "/apps" }] : []),
  { name: t("dev.nav.docs"), href: "/docs" },
  // 地面图预览不要登录：它没有上游，文件是使用者自己拖进浏览器的
  { name: t("dev.nav.ground"), href: "/ground" },
]);

const labels = computed(() => ({
  skip: t("skipToContent"),
  menu: t("openMenu"),
  close: t("closeMenu"),
  signIn: t("dev.auth.signIn"),
  signOut: t("dev.auth.signOut"),
}));
</script>

<template>
  <SiteHeader
    current="dev"
    :locale="locale"
    :pathname="pathname"
    :nav="navigation"
    :signed-in="loggedIn"
    :rating="rating"
    sign-in-href="/auth/login"
    :labels="labels"
    :origins="origins"
  >
    <template #brand>
      <span class="flex items-center gap-2.5">
        <img alt="" src="/logo.png" class="h-8 w-auto" />
        <span class="text-sm font-semibold text-ink">
          {{ t("dev.siteName") }}
        </span>
      </span>
    </template>

    <template v-if="loggedIn" #account>
      <span class="hidden text-sm text-faint lg:inline">{{ memberName }}</span>
      <form method="POST" action="/auth/logout">
        <button type="submit" class="btn btn-ghost px-4 py-2">
          {{ t("dev.auth.signOut") }}
        </button>
      </form>
    </template>

    <template v-if="loggedIn" #drawer-extra>
      <p class="px-3 pb-1 text-sm text-faint">{{ memberName }}</p>
      <form method="POST" action="/auth/logout">
        <button type="submit" class="btn btn-ghost w-full px-4 py-2.5">
          {{ t("dev.auth.signOut") }}
        </button>
      </form>
    </template>
  </SiteHeader>
</template>
