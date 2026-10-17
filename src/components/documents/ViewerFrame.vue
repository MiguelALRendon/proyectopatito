<script setup lang="ts">
defineProps<{ title: string; label: string; actionsLabel: string }>();
</script>

<template>
  <section class="viewer-frame" :aria-label="label">
    <header class="viewer-frame__toolbar">
      <h2 class="viewer-frame__title">{{ title }}</h2>
      <div
        class="viewer-frame__actions"
        role="group"
        :aria-label="actionsLabel"
      >
        <slot name="actions" />
      </div>
    </header>
    <div class="viewer-frame__body">
      <slot />
    </div>
    <footer v-if="$slots.status" class="viewer-frame__bar">
      <slot name="status" />
    </footer>
  </section>
</template>

<style scoped>
.viewer-frame {
  display: flex;
  flex-direction: column;
  block-size: 100%;
  min-block-size: var(--size-viewer-min-height);
  overflow: hidden;
  border-radius: var(--radius-lg);
  background-color: var(--color-bg);
  box-shadow: var(--shadow-clay);
}

.viewer-frame__toolbar,
.viewer-frame__bar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-xs) var(--space-md);
  background-color: var(--color-bg-elevated);
}

.viewer-frame__toolbar {
  border-bottom: var(--border-width-sm) solid var(--color-border);
}

.viewer-frame__title {
  min-inline-size: 0;
  overflow: hidden;
  font-size: var(--font-size-base);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-frame__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  margin-inline-start: auto;
}

.viewer-frame__body {
  display: flex;
  flex: 1;
  min-block-size: 0;
  min-inline-size: 0;
}

.viewer-frame__bar {
  border-top: var(--border-width-sm) solid var(--color-border);
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
}
</style>
