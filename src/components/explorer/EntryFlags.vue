<script setup lang="ts">
import { computed } from 'vue';
import type { FileEntry } from '../../services/filesApi';
import AppIcon from '../icons/AppIcon.vue';
import { entryFlags } from './entryFlags';

const props = defineProps<{ entry: FileEntry }>();

const flags = computed(() => entryFlags(props.entry));
</script>

<template>
  <span v-if="flags.length > 0" class="entry-flags" aria-hidden="true">
    <span v-for="flag in flags" :key="flag.icon" :title="flag.label">
      <AppIcon :name="flag.icon" />
    </span>
  </span>
</template>

<style scoped>
.entry-flags {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-xs);
  color: var(--color-text-muted);
}
</style>
