<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { MIDDLE_BUTTON } from '../../composables/useSelection';
import { isSamePath } from '../../utils/folderPaths';
import { CHANGES_BELOW_BADGE } from '../../utils/svnBadges';
import AppIcon from '../icons/AppIcon.vue';
import {
  flattenTree,
  nodeKey,
  treeMove,
  type TreeMove,
  type TreeNodeState,
  type TreeRow,
} from './treeRows';

const KEY_ENTER = 'Enter';
const KEY_SPACE = ' ';
const FAILED_SUFFIX = 'no se pudo leer';

const props = withDefaults(
  defineProps<{
    rootLabel: string;
    current: string;
    load: (path: string) => Promise<string[]>;
    changedFolders?: ReadonlySet<string>;
    refreshKey?: number;
  }>(),
  { changedFolders: () => new Set<string>(), refreshKey: 0 },
);

const emit = defineEmits<{ open: [path: string, inNewTab: boolean] }>();

const nodes = ref<Record<string, TreeNodeState>>({});
const expanded = ref<Set<string>>(new Set());
const focusedPath = ref<string | null>(null);
const elements = new Map<string, HTMLElement>();
const tickets = new Map<string, number>();

const rows = computed(() =>
  flattenTree({
    rootLabel: props.rootLabel,
    nodes: nodes.value,
    expanded: expanded.value,
    changed: props.changedFolders,
  }),
);
const rovingPath = computed(() => {
  const paths = rows.value.map((row) => row.path);
  return paths.find((path) => path === focusedPath.value) ?? paths[0];
});

function setElement(path: string, element: unknown) {
  if (element instanceof HTMLElement) elements.set(path, element);
  else elements.delete(path);
}

function focusRow(path: string) {
  focusedPath.value = path;
  elements.get(path)?.focus();
  elements.get(path)?.scrollIntoView?.({ block: 'nearest' });
}

async function fetchChildren(path: string) {
  const key = nodeKey(path);
  const ticket = (tickets.get(key) ?? 0) + 1;
  tickets.set(key, ticket);
  const previous = nodes.value[key]?.children ?? null;
  nodes.value[key] = { children: previous, isLoading: true, hasFailed: false };
  try {
    const children = await props.load(path);
    if (tickets.get(key) === ticket) {
      nodes.value[key] = { children, isLoading: false, hasFailed: false };
    }
  } catch {
    if (tickets.get(key) === ticket) {
      nodes.value[key] = {
        children: previous,
        isLoading: false,
        hasFailed: true,
      };
    }
  }
}

async function expand(path: string) {
  expanded.value = new Set(expanded.value).add(nodeKey(path));
  await fetchChildren(path);
}

function collapse(path: string) {
  const next = new Set(expanded.value);
  next.delete(nodeKey(path));
  expanded.value = next;
}

const toggle = (row: TreeRow) =>
  row.isExpanded ? collapse(row.path) : expand(row.path);

function activate(row: TreeRow, inNewTab: boolean) {
  focusedPath.value = row.path;
  emit('open', row.path, inNewTab);
  if (!row.isExpanded && row.canExpand) void expand(row.path);
}

function onClick(event: MouseEvent, row: TreeRow) {
  activate(row, event.ctrlKey || event.metaKey);
}

function onAuxClick(event: MouseEvent, row: TreeRow) {
  if (event.button !== MIDDLE_BUTTON) return;
  event.preventDefault();
  emit('open', row.path, true);
}

function applyMove(move: TreeMove | null): boolean {
  if (!move) return false;
  if (move.kind === 'focus') focusRow(move.path);
  else if (move.kind === 'expand') void expand(move.path);
  else collapse(move.path);
  return true;
}

function runKey(event: KeyboardEvent, row: TreeRow): boolean {
  if (event.key === KEY_ENTER || event.key === KEY_SPACE) {
    activate(row, event.ctrlKey);
    return true;
  }
  const index = rows.value.indexOf(row);
  return applyMove(treeMove(event.key, rows.value, index));
}

function onKeydown(event: KeyboardEvent, row: TreeRow) {
  if (runKey(event, row)) event.preventDefault();
}

function rowLabel(row: TreeRow): string | undefined {
  const notes = [
    row.hasChanges ? CHANGES_BELOW_BADGE.label.toLowerCase() : null,
    row.hasFailed ? FAILED_SUFFIX : null,
  ].filter((note) => note !== null);
  return notes.length > 0 ? [row.name, ...notes].join(', ') : undefined;
}

function ariaExpanded(row: TreeRow): boolean | undefined {
  return row.canExpand ? row.isExpanded : undefined;
}

function refreshExpanded() {
  rows.value
    .filter((row) => row.isExpanded)
    .forEach((row) => void fetchChildren(row.path));
}

watch(() => props.refreshKey, refreshExpanded);
onMounted(() => expand(''));
</script>

<template>
  <ul class="file-tree" role="tree" aria-label="Árbol de carpetas">
    <li
      v-for="row in rows"
      :key="row.path"
      :ref="(element) => setElement(row.path, element)"
      class="file-tree__item"
      :class="{
        'file-tree__item--current': isSamePath(row.path, current),
        'file-tree__item--failed': row.hasFailed,
      }"
      :style="{ '--tree-level': row.level - 1 }"
      role="treeitem"
      :tabindex="row.path === rovingPath ? 0 : -1"
      :aria-level="row.level"
      :aria-setsize="row.size"
      :aria-posinset="row.position"
      :aria-expanded="ariaExpanded(row)"
      :aria-selected="isSamePath(row.path, current)"
      :aria-busy="row.isLoading"
      :aria-label="rowLabel(row)"
      @click.stop="onClick($event, row)"
      @auxclick="onAuxClick($event, row)"
      @mousedown.middle.prevent
      @keydown="onKeydown($event, row)"
      @focus="focusedPath = row.path"
    >
      <span
        class="file-tree__chevron"
        aria-hidden="true"
        @click.stop="toggle(row)"
      >
        <AppIcon
          v-if="row.canExpand"
          name="forward"
          class="file-tree__arrow"
          :class="{ 'file-tree__arrow--open': row.isExpanded }"
        />
      </span>
      <AppIcon name="folder" class="file-tree__icon" />
      <span class="file-tree__name">{{ row.name }}</span>
      <span
        v-if="row.hasChanges"
        class="file-tree__changed"
        :title="CHANGES_BELOW_BADGE.label"
      >
        <AppIcon name="flag" />
      </span>
      <AppIcon v-if="row.hasFailed" name="warning" class="file-tree__warning" />
    </li>
  </ul>
</template>

<style scoped>
.file-tree {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

.file-tree__item {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  padding-inline-start: calc(
    var(--space-sm) + var(--tree-level) * var(--space-md)
  );
  border: var(--border-width-lg) solid transparent;
  border-radius: var(--radius-xl);
  color: var(--color-text);
  cursor: pointer;
  user-select: none;
}

.file-tree__item:hover {
  background-color: var(--color-bg);
}

.file-tree__item:focus-visible {
  outline: var(--border-width-lg) solid var(--color-primary);
  outline-offset: var(--outline-offset-focus);
}

.file-tree__item--current {
  border-color: var(--color-primary);
  background-color: var(--color-bg);
  box-shadow: var(--shadow-clay);
}

.file-tree__chevron {
  display: inline-flex;
  flex: none;
  inline-size: var(--size-icon);
  block-size: var(--size-icon);
  color: var(--color-text-muted);
}

.file-tree__arrow {
  transition: transform var(--duration-fast) var(--ease-standard);
}

.file-tree__arrow--open {
  transform: rotate(var(--angle-quarter-turn));
}

.file-tree__icon {
  color: var(--color-primary);
}

.file-tree__name {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-tree__changed {
  color: var(--color-conflict-marker);
}

.file-tree__warning {
  color: var(--color-error);
}

@media (prefers-reduced-motion: reduce) {
  .file-tree__arrow {
    transition: none;
  }
}
</style>
