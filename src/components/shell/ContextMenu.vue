<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { clampContextMenuPosition } from './contextMenuPosition';

export interface ContextMenuItem {
  label: string;
  action: () => unknown;
  shortcut?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
}

const props = defineProps<{
  x: number;
  y: number;
  label: string;
  items: ContextMenuItem[];
}>();

const emit = defineEmits<{ close: [] }>();

const ENABLED_ITEM = '[role="menuitem"]:not([aria-disabled="true"])';
const DISMISS_KEYS = ['Escape', 'Tab'];
const FOCUS_STEPS = new Map([
  ['ArrowDown', 1],
  ['ArrowUp', -1],
]);
const EDGE_KEYS = ['Home', 'End'];

const menu = ref<HTMLElement | null>(null);
const position = ref({ x: props.x, y: props.y });

function place() {
  const element = menu.value;
  if (!element) return;
  position.value = clampContextMenuPosition({
    x: props.x,
    y: props.y,
    menuWidth: element.offsetWidth,
    menuHeight: element.offsetHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
}

function enabledItems(): HTMLElement[] {
  return [...(menu.value?.querySelectorAll<HTMLElement>(ENABLED_ITEM) ?? [])];
}

function moveFocus(step: number) {
  const items = enabledItems();
  const current = items.indexOf(document.activeElement as HTMLElement);
  const first = step > 0 ? 0 : items.length - 1;
  const next =
    current < 0 ? first : (current + step + items.length) % items.length;
  items[next]?.focus();
}

function focusEdge(key: string) {
  const items = enabledItems();
  items[key === 'Home' ? 0 : items.length - 1]?.focus();
}

function select(item: ContextMenuItem) {
  if (item.disabled) return;
  emit('close');
  return item.action();
}

function dismiss() {
  emit('close');
}

function dismissOutside(event: Event) {
  if (!menu.value?.contains(event.target as Node)) dismiss();
}

function handleKeydown(event: KeyboardEvent) {
  if (DISMISS_KEYS.includes(event.key)) return dismiss();
  const step = FOCUS_STEPS.get(event.key);
  if (step !== undefined) {
    event.preventDefault();
    return moveFocus(step);
  }
  if (EDGE_KEYS.includes(event.key)) {
    event.preventDefault();
    focusEdge(event.key);
  }
}

onMounted(() => {
  place();
  enabledItems()[0]?.focus();
  window.addEventListener('pointerdown', dismissOutside, true);
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('blur', dismiss);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', dismissOutside, true);
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('blur', dismiss);
});
</script>

<template>
  <ul
    ref="menu"
    class="context-menu"
    role="menu"
    :aria-label="label"
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
  >
    <template v-for="item in items" :key="item.label">
      <li
        v-if="item.separatorBefore"
        class="context-menu__separator"
        role="separator"
      ></li>
      <li
        class="context-menu__item"
        role="menuitem"
        tabindex="-1"
        :aria-disabled="item.disabled ? 'true' : undefined"
        @click="select(item)"
        @keydown.enter.prevent="select(item)"
        @keydown.space.prevent="select(item)"
      >
        <span>{{ item.label }}</span>
        <kbd v-if="item.shortcut" class="context-menu__shortcut">
          {{ item.shortcut }}
        </kbd>
      </li>
    </template>
  </ul>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: var(--z-index-menu);
  box-sizing: border-box;
  min-inline-size: var(--size-menu-min-width);
  margin: 0;
  padding: var(--space-xs);
  list-style: none;
  border-radius: var(--radius-xl);
  background-color: var(--color-bg);
  box-shadow: var(--shadow-clay);
}

.context-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  min-block-size: var(--size-touch-target-min);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-family: var(--font-family-base);
  font-size: var(--font-size-base);
  cursor: pointer;
}

.context-menu__item:hover,
.context-menu__item:focus-visible {
  background-color: var(--color-bg-elevated);
}

.context-menu__item:focus-visible {
  outline-offset: calc(-1 * var(--border-width-lg));
}

.context-menu__item[aria-disabled='true'] {
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.context-menu__shortcut {
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-sm);
}

.context-menu__separator {
  margin-block: var(--space-xs);
  border-top: var(--border-width-sm) solid var(--color-border);
}

@keyframes context-menu-pop {
  from {
    opacity: var(--opacity-pop-from);
    transform: scale(var(--scale-pop-from));
  }
}

@media (prefers-reduced-motion: no-preference) {
  .context-menu {
    animation: context-menu-pop var(--duration-pop) var(--ease-elastic);
  }
}
</style>
