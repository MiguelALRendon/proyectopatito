<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { dropEdgeAt, useTabDrag } from '../../composables/useTabDrag';
import { useFavoritesStore } from '../../stores/favorites';
import {
  MAX_FAVORITE_NAME_CHARS,
  type FavoriteItem,
} from '../../utils/favoriteList';
import { focusTarget } from '../../utils/listFocus';
import AppIcon from '../icons/AppIcon.vue';
import {
  KEY_DELETE,
  KEY_RENAME,
  FAVORITE_FOCUS,
  MOVE_STEPS,
} from './favoriteKeys';

const EMPTY_SPAN = { start: 0, end: 0 };
const UNAVAILABLE_LABEL = 'No disponible';
const EMPTY_HINT = 'Marca una carpeta con la estrella para tenerla aquí.';

const favorites = useFavoritesStore();
const items = computed(() => favorites.items);
const itemElements = new Map<string, HTMLElement>();
const renaming = ref<string | null>(null);
const draft = ref('');
let wasDragged = false;

const drag = useTabDrag({
  axis: 'y',
  spans: () =>
    items.value.map((item) => {
      const box = itemElements.get(item.path)?.getBoundingClientRect();
      return box ? { start: box.top, end: box.bottom } : EMPTY_SPAN;
    }),
  indexOf: (path) => items.value.findIndex((item) => item.path === path),
  onMove: (path, to) => favorites.move(path, to),
});

const vFocusSelect = {
  mounted(element: HTMLInputElement) {
    element.focus();
    element.select();
  },
};

function setItemElement(path: string, element: unknown) {
  if (element instanceof HTMLElement) itemElements.set(path, element);
  else itemElements.delete(path);
}

async function focusLink(path: string | undefined) {
  await nextTick();
  const element = path ? itemElements.get(path) : undefined;
  element?.querySelector<HTMLElement>('.favorites__link')?.focus();
}

function dropEdge(index: number) {
  const dragged = drag.draggingId.value;
  if (dragged === null) return null;
  const from = items.value.findIndex((item) => item.path === dragged);
  return dropEdgeAt(index, from, drag.dropIndex.value);
}

function itemClasses(item: FavoriteItem, index: number) {
  const edge = dropEdge(index);
  return [
    {
      'favorites__item--dragging': item.path === drag.draggingId.value,
      'favorites__item--unavailable': !item.exists,
    },
    edge && `favorites__item--drop-${edge}`,
  ];
}

function itemStyle(item: FavoriteItem) {
  if (item.path !== drag.draggingId.value) return undefined;
  return { transform: `translateY(${drag.offset.value}px)` };
}

function startDrag(event: PointerEvent, item: FavoriteItem) {
  wasDragged = false;
  drag.start(event, item.path);
}

function endDrag() {
  wasDragged = drag.draggingId.value !== null;
  drag.end();
}

function open(item: FavoriteItem) {
  if (wasDragged) {
    wasDragged = false;
    return;
  }
  void favorites.open(item.path);
}

function startRename(item: FavoriteItem) {
  draft.value = item.name;
  renaming.value = item.path;
}

function commitRename() {
  const path = renaming.value;
  if (path === null) return;
  renaming.value = null;
  favorites.rename(path, draft.value);
  void focusLink(path);
}

function cancelRename() {
  const path = renaming.value;
  renaming.value = null;
  void focusLink(path ?? undefined);
}

function removeAt(item: FavoriteItem, index: number) {
  favorites.remove(item.path);
  const next = items.value[Math.min(index, items.value.length - 1)];
  void focusLink(next?.path);
}

function moveBy(item: FavoriteItem, index: number, step: number) {
  favorites.move(item.path, index + step);
  void focusLink(item.path);
}

function runKey(event: KeyboardEvent, item: FavoriteItem, index: number) {
  const step = MOVE_STEPS.get(event.key);
  if (event.ctrlKey && event.shiftKey && step !== undefined) {
    moveBy(item, index, step);
    return true;
  }
  if (event.key === KEY_DELETE) removeAt(item, index);
  else if (event.key === KEY_RENAME) startRename(item);
  else return focusNeighbour(event.key, index);
  return true;
}

function focusNeighbour(key: string, index: number): boolean {
  const target = focusTarget(key, index, items.value.length, FAVORITE_FOCUS);
  if (target === null) return false;
  void focusLink(items.value[target].path);
  return true;
}

function handleKeydown(
  event: KeyboardEvent,
  item: FavoriteItem,
  index: number,
) {
  if (runKey(event, item, index)) event.preventDefault();
}
</script>

<template>
  <section class="favorites" aria-labelledby="favorites-title">
    <h2 id="favorites-title" class="favorites__title">
      <AppIcon name="star" class="favorites__title-icon" />
      Favoritos
    </h2>
    <p v-if="items.length === 0" class="favorites__empty">{{ EMPTY_HINT }}</p>
    <ul v-else class="favorites__list" aria-label="Carpetas favoritas">
      <li
        v-for="(item, index) in items"
        :key="item.path"
        :ref="(element) => setItemElement(item.path, element)"
        class="favorites__item"
        :class="itemClasses(item, index)"
        :style="itemStyle(item)"
      >
        <input
          v-if="renaming === item.path"
          v-model="draft"
          v-focus-select
          class="favorites__rename"
          type="text"
          autocomplete="off"
          aria-label="Nombre del favorito"
          :maxlength="MAX_FAVORITE_NAME_CHARS"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <template v-else>
          <button
            type="button"
            class="favorites__link"
            :title="item.path || item.name"
            @click="open(item)"
            @keydown="handleKeydown($event, item, index)"
            @pointerdown="startDrag($event, item)"
            @pointermove="drag.move"
            @pointerup="endDrag"
            @pointercancel="drag.cancel"
            @lostpointercapture="drag.cancel"
          >
            <AppIcon
              :name="item.exists ? 'folder' : 'warning'"
              class="favorites__icon"
            />
            <span class="favorites__name">{{ item.name }}</span>
            <span v-if="!item.exists" class="favorites__flag">
              {{ UNAVAILABLE_LABEL }}
            </span>
          </button>
          <!-- fuera del orden de tabulación: F2 y Supr son la vía de teclado -->
          <button
            type="button"
            class="favorites__action"
            tabindex="-1"
            :aria-label="`Renombrar el favorito ${item.name}`"
            @click="startRename(item)"
          >
            <AppIcon name="edit" />
          </button>
          <button
            type="button"
            class="favorites__action"
            tabindex="-1"
            :aria-label="`Quitar el favorito ${item.name}`"
            @click="removeAt(item, index)"
          >
            <AppIcon name="close" />
          </button>
        </template>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.favorites {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.favorites__title {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-size-base);
}

.favorites__title-icon {
  color: var(--color-primary);
}

.favorites__empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.favorites__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

.favorites__item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  border: var(--border-width-lg) solid transparent;
  border-radius: var(--radius-xl);
  color: var(--color-text);
}

.favorites__item:hover,
.favorites__item:focus-within {
  background-color: var(--color-bg);
}

.favorites__item:has(.favorites__link:focus-visible) {
  outline: var(--border-width-lg) solid var(--color-primary);
  outline-offset: var(--outline-offset-focus);
}

.favorites__item--dragging {
  z-index: var(--z-index-shell);
  background-color: var(--color-bg);
  box-shadow: var(--shadow-clay);
  cursor: grabbing;
}

.favorites__item--drop-before::before,
.favorites__item--drop-after::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  block-size: var(--border-width-lg);
  background-color: var(--color-primary);
}

.favorites__item--drop-before::before {
  inset-block-start: calc(-1 * var(--space-xs));
}

.favorites__item--drop-after::after {
  inset-block-end: calc(-1 * var(--space-xs));
}

.favorites__link {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-xs);
  min-inline-size: 0;
  padding: var(--space-xs) var(--space-sm);
  border: none;
  border-radius: var(--radius-xl);
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  user-select: none;
  touch-action: none;
}

.favorites__link:focus-visible {
  outline: none;
}

.favorites__icon {
  color: var(--color-primary);
}

.favorites__item--unavailable .favorites__icon {
  color: var(--color-conflict-marker);
}

.favorites__item--unavailable .favorites__name {
  color: var(--color-text-muted);
  text-decoration: line-through;
}

.favorites__name {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorites__flag {
  flex: none;
  padding: 0 var(--space-sm);
  border: var(--border-width-sm) solid var(--color-conflict-marker);
  border-radius: var(--radius-xl);
  background-color: var(--color-conflict-bg);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}

.favorites__action {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: var(--space-lg);
  block-size: var(--space-lg);
  padding: 0;
  border: none;
  border-radius: var(--radius-xl);
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.favorites__item:hover .favorites__action,
.favorites__item:focus-within .favorites__action {
  opacity: 1;
}

.favorites__action:hover {
  color: var(--color-error);
}

.favorites__rename {
  box-sizing: border-box;
  flex: 1;
  min-inline-size: 0;
  min-block-size: var(--size-touch-target-min);
  padding: var(--space-xs) var(--space-md);
  border: var(--border-width-lg) solid var(--color-primary);
  border-radius: var(--radius-xl);
  background-color: var(--color-bg);
  color: var(--color-text);
  font: inherit;
}

@media (pointer: coarse) {
  .favorites__action {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .favorites__action {
    transition: none;
  }
}
</style>
