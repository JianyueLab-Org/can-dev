<script setup lang="ts">
/**
 * Theme + language switching in one control.
 *
 * These used to be two separate buttons fixed to the bottom-right corner,
 * which floated over page content and forced every footer to carry an
 * `sm:pr-16` escape hatch. Now they live inline in the site header and the
 * panel top bar; the `floating` variant is only used on the chrome-less auth
 * pages, and it is a single compact pill instead of a stack.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "@/components/ui/Icon.vue";

const props = withDefaults(
  defineProps<{
    locale: string;
    variant?: "inline" | "floating";
  }>(),
  { variant: "inline" },
);

const LANGUAGES = [
  { code: "zh-cn", name: "简体中文", short: "简" },
  { code: "zh-tw", name: "繁體中文", short: "繁" },
  { code: "en-us", name: "English", short: "EN" },
  { code: "ja-jp", name: "日本語", short: "日" },
];

const mounted = ref(false);
const isDark = ref(false);
const menuOpen = ref(false);
const root = ref<HTMLElement | null>(null);

const current = computed(
  () => LANGUAGES.find((l) => l.code === props.locale) ?? LANGUAGES[0],
);

/** `startViewTransition` is not in the DOM lib TypeScript ships here yet. */
type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => void) => {
    ready: Promise<void>;
    finished: Promise<void>;
  };
};

function applyTheme(dark: boolean) {
  isDark.value = dark;
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Swap the theme with a circular wipe out of the button that was pressed.
 *
 * The wipe is the browser's own view-transition machinery, not a library: the
 * new document state is snapshotted, then `::view-transition-new(root)` is
 * clipped from a zero-radius circle at the cursor out to whichever corner is
 * furthest away. `globals.css` suppresses the default cross-fade underneath it
 * (`html.theme-transitioning`), or the two would run at once and the wipe
 * would be lost behind a plain fade.
 *
 * Three cases fall back to the instant swap this used to be, which is a
 * perfectly good outcome and not a degraded one: no `startViewTransition`
 * (Safari, Firefox), no cursor position (keyboard or screen-reader
 * activation, where `clientX` is 0 and a wipe from the top-left corner would
 * be a lie about where the press came from), and an explicit reduced-motion
 * preference.
 */
function toggleTheme(event: MouseEvent) {
  const next = !isDark.value;

  // Persisted before the animation, never after: if the transition is
  // interrupted — a nav click mid-wipe, the tab going to the background — the
  // preference is already committed and the next page loads the right theme.
  localStorage.setItem("theme", next ? "dark" : "light");

  const doc = document as ViewTransitionDoc;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!doc.startViewTransition || reduced || !event.clientX) {
    applyTheme(next);
    return;
  }

  const x = event.clientX;
  const y = event.clientY;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  document.documentElement.classList.add("theme-transitioning");

  const transition = doc.startViewTransition(() => {
    applyTheme(next);
  });

  void transition.ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 500,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      },
    );
  });

  void transition.finished.finally(() => {
    document.documentElement.classList.remove("theme-transitioning");
  });
}

function changeLanguage(next: string) {
  document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;samesite=lax`;
  window.location.reload();
}

function onDocumentClick(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) menuOpen.value = false;
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") menuOpen.value = false;
}

onMounted(() => {
  isDark.value = document.documentElement.classList.contains("dark");
  mounted.value = true;
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onKeydown);
});

const buttonClass =
  "flex size-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-sunken hover:text-ink";
</script>

<template>
  <!-- Rendering is deferred until mount so the theme icon never disagrees
       with the class the no-flash inline script already applied.

       `relative` belongs to the inline variant only. Listing it
       unconditionally alongside the floating variant's `fixed` put both
       position utilities on one element, and Tailwind emits `.relative`
       after `.fixed`, so `relative` won — the "floating" control sat in
       normal flow instead, adding its own height to the document. On the
       credential pages that made the page scroll by ~46px and opened a strip
       of bare surface under the full-height artwork. Either value is a
       containing block, so the dropdown below still anchors correctly. -->
  <div
    v-if="mounted"
    ref="root"
    :class="[
      'flex items-center',
      variant === 'floating'
        ? 'fixed bottom-4 right-4 z-50 gap-0.5 rounded-full border border-subtle bg-chrome p-1 shadow-popover'
        : 'relative gap-0.5',
    ]"
  >
    <button
      type="button"
      :class="buttonClass"
      :aria-label="`Switch to ${isDark ? 'light' : 'dark'} mode`"
      :title="`Switch to ${isDark ? 'light' : 'dark'} mode`"
      @click="toggleTheme"
    >
      <Icon :name="isDark ? 'sun' : 'moon'" class="size-5" />
    </button>

    <button
      type="button"
      :class="[buttonClass, menuOpen ? 'bg-surface-sunken text-ink' : '']"
      aria-label="Select language"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
      @click="menuOpen = !menuOpen"
    >
      <span class="text-xs font-semibold tracking-tight">{{
        current.short
      }}</span>
    </button>

    <div
      v-if="menuOpen"
      role="menu"
      :class="[
        'absolute right-0 z-50 w-40 overflow-hidden rounded-card border border-subtle bg-surface-overlay py-1 shadow-popover',
        variant === 'floating' ? 'bottom-full mb-2' : 'top-full mt-2',
      ]"
    >
      <button
        v-for="language in LANGUAGES"
        :key="language.code"
        role="menuitem"
        :class="[
          'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
          language.code === locale
            ? 'font-semibold text-airwaysn'
            : 'text-muted hover:bg-surface-sunken hover:text-ink',
        ]"
        @click="changeLanguage(language.code)"
      >
        <span
          class="w-6 shrink-0 text-center text-xs font-semibold text-faint"
          >{{ language.short }}</span
        >
        <span class="truncate">{{ language.name }}</span>
        <Icon
          v-if="language.code === locale"
          name="checkCircle"
          class="ml-auto size-4"
        />
      </button>
    </div>
  </div>
</template>
