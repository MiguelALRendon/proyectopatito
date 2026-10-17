<script setup lang="ts">
import { ICON_PATHS, type IconName } from '../../utils/iconPaths';

const EVENODD = 'evenodd';

defineProps<{ name: IconName }>();
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path
      v-for="part in ICON_PATHS[name]"
      :key="part.d"
      :d="part.d"
      :opacity="'opacity' in part ? part.opacity : undefined"
      :fill-rule="'evenodd' in part ? EVENODD : undefined"
      :clip-rule="'evenodd' in part ? EVENODD : undefined"
    />
  </svg>
</template>

<style scoped>
.app-icon {
  flex: none;
  inline-size: var(--size-icon);
  block-size: var(--size-icon);
}
</style>
