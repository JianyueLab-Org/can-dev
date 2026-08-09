import { nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * Shared behaviour for the app's overlay surfaces — the mobile sidebar, the
 * quick-nav palette and the public mobile menu.
 *
 * Each of these used to be a bare `v-if` div: opening one left focus behind on
 * the trigger, Tab walked straight out of the dialog into the page underneath,
 * and the body kept scrolling behind the backdrop. Keyboard and screen-reader
 * users could not tell they were in a dialog, let alone get out of one.
 *
 * Usage:
 *   const open = ref(false)
 *   const panel = useOverlay(open)
 *   <div v-if="open" ref="panel" role="dialog" aria-modal="true">…</div>
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useOverlay(
  isOpen: Ref<boolean>,
  options: {
    /** Focus this element on open instead of the first focusable child. */
    initialFocus?: Ref<HTMLElement | HTMLInputElement | null>;
    /** Skip the body scroll lock (for non-modal popovers). */
    lockScroll?: boolean;
  } = {},
) {
  const { lockScroll = true } = options;
  const container = ref<HTMLElement | null>(null);
  let previouslyFocused: HTMLElement | null = null;

  function focusables(): HTMLElement[] {
    if (!container.value) return [];
    return [...container.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }

  function onKeydown(event: KeyboardEvent) {
    if (!isOpen.value) return;

    if (event.key === "Escape") {
      event.stopPropagation();
      isOpen.value = false;
      return;
    }

    if (event.key !== "Tab") return;

    const items = focusables();
    if (!items.length) {
      // Nothing to focus inside: keep focus on the panel rather than letting
      // it escape to the page behind the backdrop.
      event.preventDefault();
      container.value?.focus();
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (
      event.shiftKey &&
      (active === first || !container.value?.contains(active))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  watch(isOpen, async (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      if (lockScroll) document.documentElement.style.overflow = "hidden";
      document.addEventListener("keydown", onKeydown, true);
      await nextTick();
      const target = options.initialFocus?.value ?? focusables()[0];
      target?.focus();
    } else {
      if (lockScroll) document.documentElement.style.overflow = "";
      document.removeEventListener("keydown", onKeydown, true);
      // Return the caret to whatever opened the overlay.
      previouslyFocused?.focus?.();
      previouslyFocused = null;
    }
  });

  onBeforeUnmount(() => {
    if (lockScroll) document.documentElement.style.overflow = "";
    document.removeEventListener("keydown", onKeydown, true);
  });

  return container;
}
