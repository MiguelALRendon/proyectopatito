<script setup lang="ts">
import type { StateBadge } from '../../utils/svnBadges';
import AppIcon from '../icons/AppIcon.vue';

defineProps<{ badge: StateBadge }>();
</script>

<template>
  <span
    class="svn-badge"
    :class="`svn-badge--${badge.tone}`"
    :data-state="badge.key"
  >
    <AppIcon :name="badge.icon" class="svn-badge__icon" />
    <span class="svn-badge__label">{{ badge.label }}</span>
  </span>
</template>

<style scoped>
.svn-badge {
  --badge-tone: var(--color-text-muted);

  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-xs);
  padding: 0 var(--space-sm);
  border: var(--border-width-sm) solid var(--badge-tone);
  border-radius: var(--radius-xl);
  background-color: color-mix(
    in srgb,
    var(--badge-tone) var(--percent-selected-mix),
    var(--color-bg-elevated)
  );
  color: var(--color-text);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
  white-space: nowrap;
}

.svn-badge--success {
  --badge-tone: var(--color-success);
}

.svn-badge--warning {
  --badge-tone: var(--color-conflict-marker);
}

.svn-badge--danger {
  --badge-tone: var(--color-error);
}

.svn-badge__icon {
  color: var(--badge-tone);
}
</style>
