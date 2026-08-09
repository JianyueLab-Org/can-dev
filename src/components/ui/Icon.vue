<script setup lang="ts">
/**
 * Thin wrapper over the ICON_PATHS table so islands stop repeating the same
 * 8 lines of <svg> boilerplate. Size is controlled by the caller with a
 * `size-*` utility on the component (attrs fall through to the <svg>).
 */
import { computed } from "vue";
import { ICON_PATHS } from "@/components/icons";

const props = defineProps<{ name: string }>();

const path = computed(() => ICON_PATHS[props.name]);
</script>

<template>
  <svg
    v-if="path"
    class="size-5"
    fill="none"
    viewBox="0 0 24 24"
    stroke-width="1.5"
    stroke="currentColor"
    aria-hidden="true"
  >
    <path stroke-linecap="round" stroke-linejoin="round" :d="path" />
  </svg>
</template>
