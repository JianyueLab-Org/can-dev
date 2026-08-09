<script setup lang="ts">
/**
 * Inline feedback banner (form errors, action confirmations, load failures).
 * Every island used to build its own div with the status -bg/-fg pair; this
 * keeps the icon, spacing and dismiss affordance identical everywhere.
 */
import { computed } from "vue";
import Icon from "@/components/ui/Icon.vue";

const props = withDefaults(
  defineProps<{
    variant?: "success" | "danger" | "warning" | "info";
    title?: string;
    dismissible?: boolean;
  }>(),
  { variant: "info", dismissible: false },
);

defineEmits<{ (e: "dismiss"): void }>();

const tone = computed(
  () =>
    ({
      success: {
        wrap: "bg-success-bg text-success-fg",
        icon: "checkCircle",
      },
      danger: { wrap: "bg-danger-bg text-danger-fg", icon: "xCircle" },
      warning: {
        wrap: "bg-warning-bg text-warning-fg",
        icon: "exclamationTriangle",
      },
      info: { wrap: "bg-info-bg text-info-fg", icon: "informationCircle" },
    })[props.variant],
);
</script>

<template>
  <div
    :class="['flex gap-3 rounded-card px-4 py-3', tone.wrap]"
    :role="variant === 'danger' ? 'alert' : 'status'"
  >
    <Icon :name="tone.icon" class="mt-0.5 size-5 shrink-0" />
    <div class="min-w-0 flex-1 text-sm">
      <p v-if="title" class="font-semibold">{{ title }}</p>
      <div :class="title ? 'mt-0.5 opacity-90' : ''">
        <slot />
      </div>
    </div>
    <button
      v-if="dismissible"
      type="button"
      class="-m-1 shrink-0 self-start rounded-control p-1 opacity-70 transition hover:opacity-100"
      aria-label="Dismiss"
      @click="$emit('dismiss')"
    >
      <Icon name="xMark" class="size-4" />
    </button>
  </div>
</template>
