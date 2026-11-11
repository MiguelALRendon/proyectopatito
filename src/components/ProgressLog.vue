<script setup lang="ts">
defineProps<{ lines: string[]; isRunning: boolean }>();
</script>

<template>
  <section v-if="lines.length > 0 || isRunning" class="progress-log">
    <h2 id="progress-log-title">Progreso</h2>
    <p v-if="isRunning" class="progress-log__status" role="status">
      Trabajando…
    </p>
    <div
      v-if="lines.length > 0"
      class="progress-log__lines"
      role="log"
      aria-labelledby="progress-log-title"
      aria-live="polite"
      tabindex="0"
    >
      <ul>
        <li v-for="(line, index) in lines" :key="index">{{ line }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.progress-log {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.progress-log__status {
  margin: 0;
  color: var(--color-text-muted);
}

.progress-log__lines {
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  max-height: var(--size-log-max-height);
  overflow-y: auto;
  border-radius: var(--radius-md);
  background-color: var(--color-bg-elevated);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
}

.progress-log__lines ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
