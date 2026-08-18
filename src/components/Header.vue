<script setup lang="ts">
/**
 * 站头。形状是 can-web / can-radar 那一份：sticky、h-16、滚动才落阴影、
 * 跳转链接、桌面横排 + 手机抽屉、右侧一组主题/语言控件。
 *
 * 导航内容不同，那是应该的 —— can-web 和 can-radar 挂的是**网络**的导航
 * （雷达、名册、活动、下载），开发者中心是成员的工具站，挂的是它自己的三个
 * 页面，外加一条回主站的路。设计系统统一的是外形和行为，不是内容。
 *
 * 抽屉里的焦点陷阱、Escape 关闭、滚动锁和焦点归还，全部来自共享的
 * `useOverlay`，和另外两个站是同一份实现。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createTranslator } from "@/lib/i18n";
import {
  Icon,
  NetworkMenu,
  ThemeLangControls,
  sectionHeadings,
  useOverlay,
  visibleSites,
} from "@jianyuelab-org/can-ui";

const props = withDefaults(
  defineProps<{
    /** `header` 和 `dev` 两个命名空间合成的字典，见调用页。 */
    messages: Record<string, unknown>;
    /** 登录了就有，用来在右上角显示名字。 */
    memberName?: string | null;
    pathname?: string;
    locale?: string;
  }>(),
  {
    memberName: null,
    pathname: "",
    locale: "zh-cn",
  },
);

const t = createTranslator(props.messages);
const mobileMenuOpen = ref(false);
const scrolled = ref(false);

const mobilePanel = useOverlay(mobileMenuOpen);

const loggedIn = computed(() => !!props.memberName);

/** 「全网」那个词、和抽屉里铺开的那份清单，都来自 can-ui。 */
const networkLabel = computed(() => sectionHeadings(props.locale).menuLabel);
const networkSites = computed(() =>
  visibleSites({
    locale: props.locale,
    current: "dev",
    signedIn: loggedIn.value,
    excludeCurrent: true,
  }),
);

/**
 * 「我的应用」只在登录后出现。
 *
 * 匿名访客点它会被中间件弹到 `/auth/login`，那不是坏事但也没有意义 —— 一个
 * 点了就把你送走的导航项，不如不列。
 */
const navigation = computed(() =>
  [
    { name: t("dev.nav.home"), href: "/" },
    ...(loggedIn.value ? [{ name: t("dev.nav.apps"), href: "/apps" }] : []),
    { name: t("dev.nav.docs"), href: "/docs" },
    // 地面图预览不要登录：它没有上游，文件是使用者自己拖进浏览器的
    { name: t("dev.nav.ground"), href: "/ground" },
  ].filter(Boolean),
);

function isActive(href: string) {
  if (!props.pathname) return false;
  const path = props.pathname.replace(/\/+$/, "") || "/";
  const target = href.replace(/\/+$/, "") || "/";
  return path === target || path.startsWith(`${target}/`);
}

function onScroll() {
  scrolled.value = window.scrollY > 8;
}

onMounted(() => {
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
});
onBeforeUnmount(() => window.removeEventListener("scroll", onScroll));
</script>

<template>
  <header
    :class="[
      'sticky top-0 z-40 bg-chrome transition-shadow duration-200',
      scrolled
        ? 'border-b border-subtle shadow-card'
        : 'border-b border-transparent',
    ]"
  >
    <a
      href="#main-content"
      class="btn btn-primary sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50"
    >
      {{ t("skipToContent") }}
    </a>

    <nav
      aria-label="Global"
      class="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8"
    >
      <!-- 方形标记 + 文字，**不是** logo-full.png。那张图里的字是
           "Cerulean Aviation Network" —— 网络的旧名字。把它挂在这儿，站头就成
           了「旧品牌 + 新站名」并排，而且同一个名字说了两遍。文字用词条，所以
           它跟着语言走。 -->
      <a href="/" class="-m-1.5 flex shrink-0 items-center gap-2.5 p-1.5">
        <img alt="" src="/logo.png" class="h-8 w-auto" />
        <span class="text-sm font-semibold text-ink">
          {{ t("dev.siteName") }}
        </span>
      </a>

      <div class="hidden lg:ml-4 lg:flex lg:items-center lg:gap-1">
        <a
          v-for="item in navigation"
          :key="item.href"
          :href="item.href"
          :aria-current="isActive(item.href) ? 'page' : undefined"
          :class="[
            'rounded-control px-3 py-2 text-sm font-semibold transition-colors',
            isActive(item.href)
              ? 'bg-surface-sunken text-can'
              : 'text-muted hover:bg-surface-sunken hover:text-ink',
          ]"
        >
          {{ item.name }}
        </a>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <!-- 从前这里是一条孤零零的「主站」链接，也是走出开发者中心的唯一一条路。
             换成 can-ui 的「全网」菜单：主站仍在其中（那一条是公开的），管制员中
             心、考试中心、EFB、文档也终于在了。 -->
        <div class="hidden sm:block">
          <NetworkMenu :locale="locale" current="dev" :signed-in="loggedIn" />
        </div>
        <div class="hidden sm:block">
          <ThemeLangControls :locale="locale" />
        </div>

        <template v-if="loggedIn">
          <span class="hidden text-sm text-faint lg:inline">{{
            memberName
          }}</span>
          <form method="POST" action="/auth/logout" class="hidden sm:block">
            <button type="submit" class="btn btn-ghost px-4 py-2">
              {{ t("dev.auth.signOut") }}
            </button>
          </form>
        </template>
        <a
          v-else
          href="/auth/login"
          class="btn btn-primary hidden px-4 py-2 sm:inline-flex"
        >
          {{ t("dev.auth.signIn") }}
          <Icon name="arrowRight" class="size-4" />
        </a>

        <button
          type="button"
          class="-mr-2 inline-flex size-10 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-sunken hover:text-ink lg:hidden"
          @click="mobileMenuOpen = true"
        >
          <span class="sr-only">{{ t("openMenu") }}</span>
          <Icon name="bars3" class="size-6" />
        </button>
      </div>
    </nav>
  </header>

  <!-- Mobile menu. A **sibling** of <header>, never a child, and not teleported.

       <header> carries `bg-chrome`, which sets a backdrop-filter — and an
       element with a backdrop-filter becomes the containing block for its
       `position: fixed` descendants. Nested inside, `fixed inset-0` resolved
       against the 64px header rather than the viewport, so on a phone the
       backdrop was a thin strip under the bar and the panel had nowhere to
       go. It looked like the menu simply failed to render, which is how it
       was reported. Safari is strictest about it; every engine does it.

       A sibling is enough — Vue 3 allows several root nodes — and it keeps
       the original reason for not teleporting: Teleport does not survive
       Astro's Vue SSR pass cleanly. -->
  <div
    v-if="mobileMenuOpen"
    class="lg:hidden"
    role="dialog"
    aria-modal="true"
    :aria-label="t('openMenu')"
  >
    <div
      class="animate-overlay-in fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-sm"
      @click="mobileMenuOpen = false"
    ></div>
    <div
      ref="mobilePanel"
      tabindex="-1"
      class="animate-drawer-in-right fixed inset-y-0 right-0 z-50 flex w-full max-w-xs flex-col overflow-y-auto overscroll-contain border-l border-subtle bg-surface px-6 py-5 shadow-popover"
    >
      <div class="flex items-center justify-between">
        <a href="/" class="-m-1.5 flex items-center gap-2.5 p-1.5">
          <img alt="" src="/logo.png" class="h-8 w-auto" />
          <span class="text-sm font-semibold text-ink">
            {{ t("dev.siteName") }}
          </span>
        </a>
        <button
          type="button"
          class="-mr-2 inline-flex size-10 items-center justify-center rounded-control text-muted hover:bg-surface-sunken hover:text-ink"
          @click="mobileMenuOpen = false"
        >
          <span class="sr-only">{{ t("closeMenu") }}</span>
          <Icon name="xMark" class="size-6" />
        </button>
      </div>

      <div class="mt-6 flex flex-col gap-1">
        <a
          v-for="item in navigation"
          :key="item.href"
          :href="item.href"
          :class="[
            'rounded-control px-3 py-2.5 text-base font-semibold transition-colors',
            isActive(item.href)
              ? 'bg-surface-sunken text-can'
              : 'text-ink hover:bg-surface-sunken',
          ]"
        >
          {{ item.name }}
        </a>

        <!-- 全网。桌面上是一个下拉；在抽屉里铺开，因为一个弹层从抽屉里弹出来只
             会被抽屉自己盖住。数据是同一份 `visibleSites`。 -->
        <template v-if="networkSites.length">
          <div
            class="mt-4 px-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-faint"
          >
            {{ networkLabel }}
          </div>
          <a
            v-for="site in networkSites"
            :key="site.key"
            :href="site.href"
            class="rounded-control px-3 py-2.5 text-base font-semibold text-ink transition-colors hover:bg-surface-sunken"
          >
            {{ site.name }}
          </a>
        </template>
      </div>

      <div class="mt-6 border-t border-subtle pt-6">
        <template v-if="loggedIn">
          <p class="px-3 pb-3 text-sm text-faint">{{ memberName }}</p>
          <form method="POST" action="/auth/logout">
            <button type="submit" class="btn btn-ghost w-full px-4 py-2.5">
              {{ t("dev.auth.signOut") }}
            </button>
          </form>
        </template>
        <a v-else href="/auth/login" class="btn btn-primary w-full px-4 py-2.5">
          {{ t("dev.auth.signIn") }}
          <Icon name="arrowRight" class="size-4" />
        </a>
      </div>

      <div class="mt-auto pt-6">
        <ThemeLangControls :locale="locale" />
      </div>
    </div>
  </div>
</template>
