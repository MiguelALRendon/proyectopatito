<script setup lang="ts">
import { computed } from 'vue';
import type { FolderView, SortKey, ViewColumn } from '../../services/filesApi';
import type { ViewChange } from '../../stores/explorer';
import AppIcon from '../icons/AppIcon.vue';
import {
  COLUMN_OPTIONS,
  SORT_OPTIONS,
  VIEW_MODE_OPTIONS,
} from './explorerLabels';

const props = defineProps<{
  view: FolderView;
  filter: string;
  showHidden: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  isLoading: boolean;
  isFavorite: boolean;
  canCheckServer: boolean;
  isCheckingServer: boolean;
}>();

const emit = defineEmits<{
  back: [];
  forward: [];
  up: [];
  refresh: [];
  toggleHidden: [];
  toggleFavorite: [];
  checkServer: [];
  toggleColumn: [column: ViewColumn];
  changeView: [change: ViewChange];
  'update:filter': [text: string];
}>();

const isDescending = computed(() => props.view.sort_direction === 'desc');
const directionLabel = computed(() =>
  isDescending.value ? 'Orden descendente' : 'Orden ascendente',
);

function changeSort(event: Event) {
  const key = (event.target as HTMLSelectElement).value as SortKey;
  emit('changeView', { sort: key });
}

function flipDirection() {
  emit('changeView', { sort_direction: isDescending.value ? 'asc' : 'desc' });
}

function typeFilter(event: Event) {
  emit('update:filter', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div
    class="explorer-toolbar"
    role="toolbar"
    aria-label="Herramientas de la carpeta"
  >
    <div class="explorer-toolbar__group" role="group" aria-label="Navegación">
      <button
        type="button"
        class="explorer-toolbar__button explorer-toolbar__button--icon"
        aria-label="Atrás"
        title="Atrás"
        :disabled="!canGoBack"
        @click="emit('back')"
      >
        <AppIcon name="back" />
      </button>
      <button
        type="button"
        class="explorer-toolbar__button explorer-toolbar__button--icon"
        aria-label="Adelante"
        title="Adelante"
        :disabled="!canGoForward"
        @click="emit('forward')"
      >
        <AppIcon name="forward" />
      </button>
      <button
        type="button"
        class="explorer-toolbar__button explorer-toolbar__button--icon"
        aria-label="Subir un nivel"
        title="Subir un nivel"
        :disabled="!canGoUp"
        @click="emit('up')"
      >
        <AppIcon name="up" />
      </button>
      <button
        type="button"
        class="explorer-toolbar__button explorer-toolbar__button--icon"
        aria-label="Actualizar"
        title="Actualizar"
        :disabled="isLoading"
        @click="emit('refresh')"
      >
        <AppIcon name="refresh" />
      </button>
    </div>

    <div class="explorer-toolbar__group" role="group" aria-label="Carpeta">
      <button
        type="button"
        class="explorer-toolbar__button explorer-toolbar__button--icon"
        aria-label="Marcar como favorita"
        title="Marcar como favorita"
        :aria-pressed="isFavorite"
        @click="emit('toggleFavorite')"
      >
        <AppIcon :name="isFavorite ? 'star-filled' : 'star'" />
      </button>
      <button
        type="button"
        class="explorer-toolbar__button"
        :disabled="!canCheckServer || isCheckingServer"
        :aria-busy="isCheckingServer"
        :title="
          canCheckServer
            ? 'Compara la copia con el servidor'
            : 'Solo disponible dentro de una copia de trabajo'
        "
        @click="emit('checkServer')"
      >
        <AppIcon name="server" />
        Comprobar servidor
      </button>
    </div>

    <div class="explorer-toolbar__group" role="group" aria-label="Vista">
      <button
        v-for="option in VIEW_MODE_OPTIONS"
        :key="option.mode"
        type="button"
        class="explorer-toolbar__button"
        :aria-pressed="view.mode === option.mode"
        @click="emit('changeView', { mode: option.mode })"
      >
        <AppIcon :name="option.icon" />
        {{ option.label }}
      </button>
    </div>

    <div
      v-if="view.mode === 'details'"
      class="explorer-toolbar__group"
      role="group"
      aria-label="Columnas"
    >
      <button
        v-for="option in COLUMN_OPTIONS"
        :key="option.column"
        type="button"
        class="explorer-toolbar__button"
        :aria-pressed="view.columns.includes(option.column)"
        @click="emit('toggleColumn', option.column)"
      >
        {{ option.label }}
      </button>
    </div>

    <div class="explorer-toolbar__group" role="group" aria-label="Orden">
      <select
        class="explorer-toolbar__field explorer-toolbar__select"
        aria-label="Ordenar por"
        :value="view.sort"
        @change="changeSort"
      >
        <option
          v-for="option in SORT_OPTIONS"
          :key="option.key"
          :value="option.key"
        >
          {{ option.label }}
        </option>
      </select>
      <button
        type="button"
        class="explorer-toolbar__button explorer-toolbar__button--icon"
        :aria-label="directionLabel"
        :title="directionLabel"
        @click="flipDirection"
      >
        <span aria-hidden="true">{{ isDescending ? '↓' : '↑' }}</span>
      </button>
    </div>

    <div class="explorer-toolbar__group" role="group" aria-label="Filtro">
      <button
        type="button"
        class="explorer-toolbar__button"
        :aria-pressed="showHidden"
        @click="emit('toggleHidden')"
      >
        <AppIcon :name="showHidden ? 'eye' : 'eye-closed'" />
        Ocultos
      </button>
      <label class="explorer-toolbar__search">
        <AppIcon name="search" class="explorer-toolbar__search-icon" />
        <input
          type="search"
          class="explorer-toolbar__field explorer-toolbar__filter"
          aria-label="Filtrar por nombre"
          placeholder="Filtrar por nombre"
          autocomplete="off"
          :value="filter"
          @input="typeFilter"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.explorer-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm) var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-xl);
  background-color: var(--color-bg-elevated);
  box-shadow: var(--shadow-clay);
}

.explorer-toolbar__group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.explorer-toolbar__button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-block-size: var(--size-touch-target-min);
  padding: var(--space-xs) var(--space-md);
  border: none;
  border-radius: var(--radius-xl);
  background-color: var(--color-bg);
  color: var(--color-text);
  box-shadow: var(--shadow-clay);
  font-family: var(--font-family-base);
  font-size: var(--font-size-base);
  cursor: pointer;
}

.explorer-toolbar__button--icon {
  justify-content: center;
  min-inline-size: var(--size-touch-target-min);
  padding-inline: var(--space-sm);
}

.explorer-toolbar__button :deep(.app-icon) {
  color: var(--color-primary);
}

.explorer-toolbar__button:hover:not(:disabled) {
  background-color: var(--color-bg-elevated);
}

.explorer-toolbar__button[aria-pressed='true'] {
  background-color: var(--color-primary);
  color: var(--color-bg);
}

.explorer-toolbar__button[aria-pressed='true'] :deep(.app-icon) {
  color: var(--color-bg);
}

.explorer-toolbar__button[aria-pressed='true']:hover {
  background-color: var(--color-primary-hover);
}

.explorer-toolbar__button:disabled {
  opacity: var(--opacity-disabled);
  cursor: not-allowed;
}

.explorer-toolbar__button:focus-visible,
.explorer-toolbar__field:focus-visible {
  outline: var(--border-width-lg) solid var(--color-primary);
  outline-offset: var(--outline-offset-focus);
}

.explorer-toolbar__field {
  box-sizing: border-box;
  min-block-size: var(--size-touch-target-min);
  padding: var(--space-xs) var(--space-md);
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-xl);
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-base);
}

.explorer-toolbar__select {
  min-inline-size: var(--size-select-min-width);
}

.explorer-toolbar__search {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.explorer-toolbar__search-icon {
  position: absolute;
  inset-inline-start: var(--space-md);
  color: var(--color-text-muted);
  pointer-events: none;
}

.explorer-toolbar__filter {
  min-inline-size: var(--size-filter-min-width);
  padding-inline-start: calc(
    var(--space-md) + var(--size-icon) + var(--space-sm)
  );
}

.explorer-toolbar__filter::placeholder {
  color: var(--color-text-muted);
}
</style>
