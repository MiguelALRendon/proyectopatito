<script setup lang="ts">
import { computed } from 'vue';
import { useItemFocus, useSelection } from '../../composables/useSelection';
import type {
  FileEntry,
  SortDirection,
  SortKey,
  ViewColumn,
  ViewMode,
} from '../../services/filesApi';
import {
  entrySizeLabel,
  entryTypeLabel,
  formatModified,
} from '../../utils/entryDisplay';
import { changeBadges, type StateBadge } from '../../utils/svnBadges';
import AppIcon from '../icons/AppIcon.vue';
import EntryFlags from './EntryFlags.vue';
import SvnStateBadge from './SvnStateBadge.vue';
import { entryAriaLabel } from './entryFlags';
import {
  COLUMN_OPTIONS,
  COLUMN_SORT_KEY,
  COLUMN_TRACK,
  NAME_TRACK,
} from './explorerLabels';

const SINGLE_COLUMN = 1;
const ARIA_SORT: Record<SortDirection, 'ascending' | 'descending'> = {
  asc: 'ascending',
  desc: 'descending',
};

const NO_BADGES: StateBadge[] = [];

const props = withDefaults(
  defineProps<{
    entries: FileEntry[];
    columns: ViewColumn[];
    mode: Exclude<ViewMode, 'grid'>;
    sort: SortKey;
    direction: SortDirection;
    badges?: ReadonlyMap<string, StateBadge[]>;
  }>(),
  { badges: () => new Map() },
);

const emit = defineEmits<{
  open: [name: string, inNewTab: boolean];
  sort: [key: SortKey];
}>();

const selected = defineModel<string[]>('selected', { required: true });
const { setItem, focusItem } = useItemFocus();

const selection = useSelection({
  items: () => props.entries.map((entry) => entry.name),
  selected,
  columns: () => SINGLE_COLUMN,
  open: (name, inNewTab) => emit('open', name, inNewTab),
  focusItem,
});

const isDetails = computed(() => props.mode === 'details');
const shownColumns = computed(() =>
  isDetails.value
    ? COLUMN_OPTIONS.filter((option) => props.columns.includes(option.column))
    : [],
);
const tracks = computed(() =>
  [NAME_TRACK, ...shownColumns.value.map((o) => COLUMN_TRACK[o.column])].join(
    ' ',
  ),
);

const hasSvnColumn = computed(() =>
  shownColumns.value.some((option) => option.column === 'svn'),
);

const badgesOf = (entry: FileEntry) =>
  props.badges.get(entry.name) ?? NO_BADGES;
const inlineBadges = (entry: FileEntry) =>
  hasSvnColumn.value ? NO_BADGES : changeBadges(badgesOf(entry));

function cellText(entry: FileEntry, column: ViewColumn): string {
  if (column === 'type') return entryTypeLabel(entry);
  if (column === 'size') return entrySizeLabel(entry);
  return formatModified(entry.modified_ms);
}

function ariaSortOf(key: SortKey): 'ascending' | 'descending' | 'none' {
  return props.sort === key ? ARIA_SORT[props.direction] : 'none';
}
</script>

<template>
  <div
    class="file-list"
    :class="{ 'file-list--details': isDetails }"
    role="grid"
    aria-label="Contenido de la carpeta"
    aria-multiselectable="true"
    :style="{ '--file-list-tracks': tracks }"
  >
    <div v-if="isDetails" class="file-list__line file-list__header" role="row">
      <div role="columnheader" :aria-sort="ariaSortOf('name')">
        <button
          type="button"
          class="file-list__sort"
          @click="emit('sort', 'name')"
        >
          Nombre
        </button>
      </div>
      <div
        v-for="option in shownColumns"
        :key="option.column"
        role="columnheader"
        :aria-sort="ariaSortOf(COLUMN_SORT_KEY[option.column] ?? 'name')"
      >
        <button
          type="button"
          class="file-list__sort"
          @click="emit('sort', COLUMN_SORT_KEY[option.column] ?? 'name')"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
    <div
      v-for="entry in entries"
      :key="entry.name"
      :ref="(element) => setItem(entry.name, element)"
      class="file-list__line file-list__row"
      :class="{ 'file-list__row--blocked': entry.escapes_workspace }"
      role="row"
      :tabindex="selection.rovingKey.value === entry.name ? 0 : -1"
      :aria-selected="selection.isSelected(entry.name)"
      :aria-label="entryAriaLabel(entry, badgesOf(entry))"
      @click="selection.onClick($event, entry.name)"
      @dblclick="selection.onOpen($event, entry.name)"
      @keydown="selection.onKeydown($event, entry.name)"
      @focus="selection.onFocus(entry.name)"
      @mousedown.middle.prevent
      @auxclick="selection.onAuxClick($event, entry.name)"
    >
      <div role="gridcell" class="file-list__cell file-list__cell--name">
        <AppIcon
          :name="entry.kind === 'dir' ? 'folder' : 'document'"
          class="file-list__icon"
        />
        <span class="file-list__name">{{ entry.name }}</span>
        <EntryFlags :entry="entry" />
        <SvnStateBadge
          v-for="badge in inlineBadges(entry)"
          :key="badge.key"
          :badge="badge"
        />
      </div>
      <div
        v-for="option in shownColumns"
        :key="option.column"
        role="gridcell"
        class="file-list__cell file-list__cell--data"
        :class="{ 'file-list__cell--badges': option.column === 'svn' }"
      >
        <template v-if="option.column === 'svn'">
          <SvnStateBadge
            v-for="badge in badgesOf(entry)"
            :key="badge.key"
            :badge="badge"
          />
        </template>
        <template v-else>{{ cellText(entry, option.column) }}</template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm);
  border-radius: var(--radius-xl);
  background-color: var(--color-bg-elevated);
  box-shadow: var(--shadow-clay);
}

.file-list__line {
  display: grid;
  grid-template-columns: var(--file-list-tracks);
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-xs) var(--space-sm);
}

.file-list__header {
  color: var(--color-text-muted);
  font-weight: var(--font-weight-bold);
}

.file-list__sort {
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.file-list__sort:focus-visible {
  outline: var(--border-width-lg) solid var(--color-primary);
  outline-offset: var(--outline-offset-focus);
}

[aria-sort='ascending'] .file-list__sort::after {
  content: ' ↑' / '';
}

[aria-sort='descending'] .file-list__sort::after {
  content: ' ↓' / '';
}

.file-list__row {
  border: var(--border-width-lg) solid transparent;
  border-radius: var(--radius-xl);
  color: var(--color-text);
  cursor: pointer;
  user-select: none;
}

.file-list__row:hover {
  background-color: var(--color-bg);
}

.file-list__row:focus-visible {
  outline: var(--border-width-lg) solid var(--color-primary);
  outline-offset: var(--outline-offset-focus);
}

.file-list__row[aria-selected='true'] {
  border-color: var(--color-primary);
  background-color: color-mix(
    in srgb,
    var(--color-primary) var(--percent-selected-mix),
    var(--color-bg-elevated)
  );
  box-shadow: var(--shadow-clay);
}

.file-list__row--blocked {
  cursor: not-allowed;
}

.file-list__cell {
  min-inline-size: 0;
}

.file-list__cell--name {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.file-list__cell--data {
  overflow: hidden;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-list__cell--badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  overflow: visible;
  white-space: normal;
}

.file-list__icon {
  color: var(--color-primary);
}

.file-list__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
