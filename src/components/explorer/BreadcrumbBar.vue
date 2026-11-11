<script setup lang="ts">
import { computed } from 'vue';
import { MIDDLE_BUTTON } from '../../composables/useSelection';
import { ROOT_TAB_TITLE } from '../../stores/tabs';
import { breadcrumbs } from '../../utils/folderPaths';
import AppIcon from '../icons/AppIcon.vue';

const props = defineProps<{ path: string }>();

const emit = defineEmits<{
  navigate: [path: string, inNewTab: boolean];
}>();

const crumbs = computed(() => breadcrumbs(props.path));
const isAtRoot = computed(() => crumbs.value.length === 0);

function activate(event: MouseEvent, path: string) {
  emit('navigate', path, event.ctrlKey || event.metaKey);
}

function activateInNewTab(event: MouseEvent, path: string) {
  if (event.button !== MIDDLE_BUTTON) return;
  event.preventDefault();
  emit('navigate', path, true);
}
</script>

<template>
  <nav class="breadcrumb-bar" aria-label="Ruta de navegación">
    <button
      type="button"
      class="breadcrumb-bar__item"
      :class="{ 'breadcrumb-bar__item--active': isAtRoot }"
      :aria-current="isAtRoot ? 'page' : undefined"
      @click="activate($event, '')"
      @mousedown.middle.prevent
      @auxclick="activateInNewTab($event, '')"
    >
      <AppIcon name="folder" class="breadcrumb-bar__icon" />
      {{ ROOT_TAB_TITLE }}
    </button>
    <template v-for="(crumb, index) in crumbs" :key="crumb.path">
      <span class="breadcrumb-bar__separator" aria-hidden="true">/</span>
      <button
        type="button"
        class="breadcrumb-bar__item"
        :class="{
          'breadcrumb-bar__item--active': index === crumbs.length - 1,
        }"
        :aria-current="index === crumbs.length - 1 ? 'page' : undefined"
        @click="activate($event, crumb.path)"
        @mousedown.middle.prevent
        @auxclick="activateInNewTab($event, crumb.path)"
      >
        {{ crumb.label }}
      </button>
    </template>
  </nav>
</template>

<style scoped>
.breadcrumb-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-xl);
  background-color: var(--color-bg-elevated);
  box-shadow: var(--shadow-clay);
}

.breadcrumb-bar__item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border: none;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-family-base);
  font-size: var(--font-size-base);
  cursor: pointer;
}

.breadcrumb-bar__icon {
  color: var(--color-primary);
}

.breadcrumb-bar__item:hover {
  background-color: var(--color-bg);
}

.breadcrumb-bar__item:focus-visible {
  outline: var(--border-width-lg) solid var(--color-primary);
  outline-offset: var(--outline-offset-focus);
}

.breadcrumb-bar__item--active {
  color: var(--color-text);
  font-weight: var(--font-weight-bold);
}

.breadcrumb-bar__separator {
  color: var(--color-text-muted);
}
</style>
