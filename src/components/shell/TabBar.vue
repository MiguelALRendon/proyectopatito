<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { dropEdgeAt, useTabDrag } from '../../composables/useTabDrag';
import { useTabsStore } from '../../stores/tabs';
import type { Tab } from '../../services/filesApi';
import ContextMenu, { type ContextMenuItem } from './ContextMenu.vue';
import { TAB_PANEL_ID, tabDomId } from './tabIds';
import {
  KEY_DELETE,
  MIDDLE_BUTTON,
  MOVE_STEPS,
  TAB_FOCUS,
  isMenuKey,
} from './tabKeys';
import { tabMenuItems } from './tabMenuItems';
import { focusTarget } from '../../utils/listFocus';

interface OpenMenu {
  id: string;
  x: number;
  y: number;
}

const MENU_LABEL = 'Acciones de la pestaña';
const DIRTY_SUFFIX = ' (cambios sin guardar)';
const EMPTY_SPAN = { start: 0, end: 0 };

const tabs = useTabsStore();
const itemElements = new Map<string, HTMLElement>();
const list = ref<HTMLElement | null>(null);
const menu = ref<OpenMenu | null>(null);

const drag = useTabDrag({
  spans: () =>
    tabs.tabs.map((tab) => {
      const box = itemElements.get(tab.id)?.getBoundingClientRect();
      return box ? { start: box.left, end: box.right } : EMPTY_SPAN;
    }),
  indexOf: (id) => tabs.tabs.findIndex((tab) => tab.id === id),
  onMove: (id, to) => tabs.move(id, to),
});

const focusableId = computed(() => tabs.activeId ?? tabs.tabs[0]?.id ?? null);

function setItemElement(id: string, element: unknown) {
  if (element instanceof HTMLElement) itemElements.set(id, element);
  else itemElements.delete(id);
}

function focusTab(id: string | null) {
  const element = id ? itemElements.get(id) : undefined;
  element?.querySelector<HTMLElement>('[role="tab"]')?.focus();
}

function tabLabel(tab: Tab): string {
  return tabs.isDirty(tab.id) ? `${tab.title}${DIRTY_SUFFIX}` : tab.title;
}

function dropEdge(index: number) {
  const dragged = drag.draggingId.value;
  if (dragged === null) return null;
  const from = tabs.tabs.findIndex((tab) => tab.id === dragged);
  return dropEdgeAt(index, from, drag.dropIndex.value);
}

function itemClasses(tab: Tab, index: number) {
  const edge = dropEdge(index);
  return [
    {
      'tab-bar__item--active': tab.id === tabs.activeId,
      'tab-bar__item--dragging': tab.id === drag.draggingId.value,
    },
    edge && `tab-bar__item--drop-${edge}`,
  ];
}

function itemStyle(tab: Tab) {
  if (tab.id !== drag.draggingId.value) return undefined;
  return { transform: `translateX(${drag.offset.value}px)` };
}

async function closeAndFocus(id: string) {
  if (await tabs.close(id)) {
    await nextTick();
    focusTab(tabs.activeId);
  }
}

function showMenu(id: string, x: number, y: number) {
  menu.value = { id, x, y };
}

function showMenuAtPointer(event: MouseEvent, id: string) {
  showMenu(id, event.clientX, event.clientY);
}

function showMenuAtTab(id: string) {
  const box = itemElements.get(id)?.getBoundingClientRect();
  if (box) showMenu(id, box.left, box.bottom);
}

function closeMenu() {
  const owner = menu.value?.id ?? null;
  const hadFocus = document.activeElement?.closest('[role="menu"]');
  menu.value = null;
  if (hadFocus) focusTab(owner);
}

function menuItems(id: string): ContextMenuItem[] {
  const state = {
    index: tabs.tabs.findIndex((tab) => tab.id === id),
    count: tabs.tabs.length,
    canOpen: tabs.canOpen,
  };
  return tabMenuItems(state, {
    close: () => closeAndFocus(id),
    closeOthers: () => tabs.closeOthers(id),
    closeToTheRight: () => tabs.closeToTheRight(id),
    duplicate: () => tabs.duplicate(id),
  });
}

async function moveWithKeyboard(id: string, index: number, step: number) {
  tabs.move(id, index + step);
  await nextTick();
  focusTab(id);
}

function focusNeighbour(key: string, index: number): boolean {
  const target = focusTarget(key, index, tabs.tabs.length, TAB_FOCUS);
  if (target === null) return false;
  focusTab(tabs.tabs[target].id);
  return true;
}

function runKey(event: KeyboardEvent, id: string): boolean {
  const index = tabs.tabs.findIndex((tab) => tab.id === id);
  const step = MOVE_STEPS.get(event.key);
  if (event.ctrlKey && event.shiftKey && step !== undefined) {
    moveWithKeyboard(id, index, step);
    return true;
  }
  if (event.key === KEY_DELETE) {
    closeAndFocus(id);
    return true;
  }
  if (!isMenuKey(event)) return focusNeighbour(event.key, index);
  showMenuAtTab(id);
  return true;
}

function handleKeydown(event: KeyboardEvent, id: string) {
  if (runKey(event, id)) event.preventDefault();
}

function handleAuxClick(event: MouseEvent, id: string) {
  if (event.button !== MIDDLE_BUTTON) return;
  event.preventDefault();
  tabs.close(id);
}

function scrollHorizontally(event: WheelEvent) {
  if (event.deltaX === 0 && list.value) list.value.scrollLeft += event.deltaY;
}

function revealActive(id: string | null) {
  const element = id ? itemElements.get(id) : undefined;
  element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

watch(() => tabs.activeId, revealActive, { flush: 'post' });
</script>

<template>
  <div class="tab-bar">
    <div class="tab-bar__strip">
      <div
        ref="list"
        class="tab-bar__list"
        role="tablist"
        aria-label="Pestañas abiertas"
        @wheel="scrollHorizontally"
      >
        <div
          v-for="(tab, index) in tabs.tabs"
          :key="tab.id"
          :ref="(element) => setItemElement(tab.id, element)"
          class="tab-bar__item"
          :class="itemClasses(tab, index)"
          :style="itemStyle(tab)"
          role="presentation"
        >
          <button
            :id="tabDomId(tab.id)"
            type="button"
            class="tab-bar__tab"
            role="tab"
            :aria-selected="tab.id === tabs.activeId"
            :aria-controls="tab.id === tabs.activeId ? TAB_PANEL_ID : undefined"
            :aria-label="tabLabel(tab)"
            :tabindex="tab.id === focusableId ? 0 : -1"
            :title="tab.path || tab.title"
            @click="tabs.activate(tab.id)"
            @keydown="handleKeydown($event, tab.id)"
            @contextmenu.prevent="showMenuAtPointer($event, tab.id)"
            @mousedown.middle.prevent
            @auxclick="handleAuxClick($event, tab.id)"
            @pointerdown="drag.start($event, tab.id)"
            @pointermove="drag.move"
            @pointerup="drag.end"
            @pointercancel="drag.cancel"
            @lostpointercapture="drag.cancel"
          >
            <span class="tab-bar__title">{{ tab.title }}</span>
            <span
              v-if="tabs.isDirty(tab.id)"
              class="tab-bar__dirty"
              aria-hidden="true"
              >●</span
            >
          </button>
          <!-- fuera del orden de tabulación: Supr es la vía de teclado -->
          <button
            type="button"
            class="tab-bar__close"
            tabindex="-1"
            :aria-label="`Cerrar pestaña ${tab.title}`"
            @click="tabs.close(tab.id)"
          >
            ×
          </button>
        </div>
      </div>
      <button
        type="button"
        class="tab-bar__add"
        :disabled="tabs.isRestoring"
        aria-label="Abrir Mis archivos en una pestaña"
        @click="tabs.open('')"
      >
        +
      </button>
    </div>
    <div role="status">
      <div v-if="tabs.notice" class="banner banner--warning tab-bar__notice">
        <span>{{ tabs.notice }}</span>
        <button type="button" class="btn" @click="tabs.notice = null">
          Entendido
        </button>
      </div>
    </div>
    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :label="MENU_LABEL"
      :items="menuItems(menu.id)"
      @close="closeMenu"
    />
  </div>
</template>

<style scoped>
.tab-bar {
  background-color: var(--color-bg-elevated);
}

.tab-bar__strip {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm) 0;
}

.tab-bar__list {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--space-xs);
  min-inline-size: 0;
  padding: var(--space-sm) var(--space-sm) var(--space-md);
  overflow-x: auto;
}

.tab-bar__item {
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex: none;
  align-items: stretch;
  min-block-size: var(--size-touch-target-min);
  max-inline-size: var(--size-tab-max-width);
  border: var(--border-width-lg) solid transparent;
  border-radius: var(--radius-xl);
  background-color: var(--color-bg);
  color: var(--color-text);
}

.tab-bar__item:hover,
.tab-bar__item--active {
  box-shadow: var(--shadow-clay);
}

.tab-bar__item--active {
  border-color: var(--color-primary);
}

.tab-bar__item:has(.tab-bar__tab:focus-visible) {
  outline: var(--border-width-lg) solid var(--color-primary);
  outline-offset: var(--outline-offset-focus);
}

.tab-bar__item--dragging {
  z-index: var(--z-index-shell);
  cursor: grabbing;
}

.tab-bar__item--drop-before::before,
.tab-bar__item--drop-after::after {
  content: '';
  position: absolute;
  inset-block: 0;
  inline-size: var(--border-width-lg);
  background-color: var(--color-primary);
}

.tab-bar__item--drop-before::before {
  inset-inline-start: calc(-1 * var(--space-xs));
}

.tab-bar__item--drop-after::after {
  inset-inline-end: calc(-1 * var(--space-xs));
}

.tab-bar__tab {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-xs);
  min-inline-size: 0;
  padding: var(--space-xs) var(--space-xs) var(--space-xs) var(--space-md);
  border: none;
  border-radius: var(--radius-xl);
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  user-select: none;
}

.tab-bar__tab:focus-visible {
  outline: none;
}

.tab-bar__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-bar__dirty {
  flex: none;
  color: var(--color-primary);
  font-size: var(--font-size-sm);
}

.tab-bar__close {
  display: flex;
  flex: none;
  align-self: center;
  align-items: center;
  justify-content: center;
  inline-size: var(--space-lg);
  block-size: var(--space-lg);
  margin-inline-end: var(--space-xs);
  border: none;
  border-radius: var(--radius-xl);
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-lg);
  line-height: 1;
  cursor: pointer;
}

.tab-bar__close:hover {
  color: var(--color-error);
}

.tab-bar__add {
  flex: none;
  inline-size: var(--size-touch-target-min);
  block-size: var(--size-touch-target-min);
  border: none;
  border-radius: var(--radius-xl);
  background-color: var(--color-bg);
  color: var(--color-text);
  box-shadow: var(--shadow-clay);
  font: inherit;
  font-size: var(--font-size-lg);
  line-height: 1;
  cursor: pointer;
}

.tab-bar__add:hover:not(:disabled) {
  background-color: var(--color-bg-elevated);
}

.tab-bar__add:disabled {
  opacity: var(--opacity-disabled);
  cursor: not-allowed;
}

.tab-bar__notice {
  margin: var(--space-xs);
}

@keyframes tab-bar-enter {
  from {
    opacity: 0;
    transform: translateY(calc(-1 * var(--space-xs)));
  }
}

@keyframes tab-bar-pop {
  from {
    opacity: var(--opacity-pop-from);
    transform: scale(var(--scale-pop-from));
  }
}

@media (prefers-reduced-motion: no-preference) {
  .tab-bar__item {
    animation: tab-bar-enter var(--duration-enter) var(--ease-standard);
  }

  .tab-bar__item--active .tab-bar__tab {
    animation: tab-bar-pop var(--duration-pop) var(--ease-elastic);
  }
}
</style>
