<script setup lang="ts">
import { ref } from 'vue';
import { changeBadges, type StateBadge } from '../../utils/svnBadges';
import { useItemFocus, useSelection } from '../../composables/useSelection';
import type { FileEntry } from '../../services/filesApi';
import AppIcon from '../icons/AppIcon.vue';
import EntryFlags from './EntryFlags.vue';
import SvnStateBadge from './SvnStateBadge.vue';
import { entryAriaLabel } from './entryFlags';

const SINGLE_COLUMN = 1;
const NO_BADGES: StateBadge[] = [];

const props = withDefaults(
  defineProps<{
    entries: FileEntry[];
    badges?: ReadonlyMap<string, StateBadge[]>;
  }>(),
  { badges: () => new Map() },
);

const badgesOf = (entry: FileEntry) =>
  props.badges.get(entry.name) ?? NO_BADGES;

const emit = defineEmits<{
  open: [name: string, inNewTab: boolean];
}>();

const selected = defineModel<string[]>('selected', { required: true });
const gridElement = ref<HTMLElement | null>(null);
const { setItem, focusItem } = useItemFocus();

function columnCount(): number {
  if (!gridElement.value) return SINGLE_COLUMN;
  const tracks = getComputedStyle(gridElement.value).gridTemplateColumns;
  return tracks.split(' ').filter(Boolean).length || SINGLE_COLUMN;
}

const selection = useSelection({
  items: () => props.entries.map((entry) => entry.name),
  selected,
  columns: columnCount,
  open: (name, inNewTab) => emit('open', name, inNewTab),
  focusItem,
});
</script>

<template>
  <div
    ref="gridElement"
    class="file-grid"
    role="grid"
    aria-label="Contenido de la carpeta"
    aria-multiselectable="true"
  >
    <div
      v-for="entry in entries"
      :key="entry.name"
      :ref="(element) => setItem(entry.name, element)"
      class="file-grid__item"
      :class="{ 'file-grid__item--blocked': entry.escapes_workspace }"
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
      <div role="gridcell" class="file-grid__cell">
        <AppIcon
          :name="entry.kind === 'dir' ? 'folder' : 'document'"
          class="file-grid__icon"
        />
        <span class="file-grid__title">{{ entry.name }}</span>
        <div class="file-grid__badges">
          <SvnStateBadge
            v-for="badge in changeBadges(badgesOf(entry))"
            :key="badge.key"
            :badge="badge"
          />
        </div>
        <EntryFlags :entry="entry" class="file-grid__flags" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-grid {
  display: grid;
  grid-template-columns: repeat(
    auto-fill,
    minmax(var(--size-grid-item-min-width), 1fr)
  );
  gap: var(--space-md);
}

.file-grid__item {
  position: relative;
  display: flex;
  border: var(--border-width-lg) solid transparent;
  border-radius: var(--radius-xl);
  background-color: var(--color-bg-elevated);
  box-shadow: var(--shadow-clay);
  color: var(--color-text);
  cursor: pointer;
  user-select: none;
}

.file-grid__cell {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  min-inline-size: 0;
  gap: var(--space-xs);
  padding: var(--space-md);
  text-align: center;
}

.file-grid__item:hover {
  background-color: var(--color-bg);
}

.file-grid__item:focus-visible {
  outline: var(--border-width-lg) solid var(--color-primary);
  outline-offset: var(--outline-offset-focus);
}

.file-grid__item[aria-selected='true'] {
  border-color: var(--color-primary);
  background-color: color-mix(
    in srgb,
    var(--color-primary) var(--percent-selected-mix),
    var(--color-bg-elevated)
  );
}

.file-grid__item--blocked {
  cursor: not-allowed;
}

.file-grid__cell .file-grid__icon {
  inline-size: var(--size-icon-card);
  block-size: var(--size-icon-card);
  color: var(--color-primary);
  font-size: var(--font-size-lg);
}

.file-grid__title {
  overflow-wrap: anywhere;
  font-family: var(--font-family-base);
  font-size: var(--font-size-base);
}

.file-grid__badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-xs);
  max-inline-size: 100%;
}

.file-grid__badges :deep(.svn-badge) {
  flex: 0 1 auto;
  min-inline-size: 0;
  border-radius: var(--radius-lg);
  text-align: center;
  white-space: normal;
}

.file-grid__flags {
  position: absolute;
  inset-block-start: var(--space-sm);
  inset-inline-end: var(--space-sm);
}
</style>
