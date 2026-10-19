<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import {
  FORMAT_LABELS,
  countLabel,
  displayName,
  hasHiddenCharacters,
} from '../../documents/archive';
import {
  ARCHIVE_ENCRYPTED_NOTICE,
  ARCHIVE_FAILURE_PREFIX,
  ARCHIVE_LISTING_TEXT,
  ARCHIVE_TRUNCATED_NOTICE,
} from '../../documents/labels';
import {
  archiveCancel,
  archiveList,
  newArchiveTaskId,
  type ArchiveEntry,
  type ArchiveListing,
} from '../../services/archiveApi';
import type { FileProbe } from '../../services/filesApi';
import { normalizeError, type CommandError } from '../../services/tauri';
import { useExplorerStore } from '../../stores/explorer';
import { useTabsStore } from '../../stores/tabs';
import { formatSize } from '../../utils/entryDisplay';
import { fileNameOf } from '../../utils/folderPaths';
import type { IconName } from '../../utils/iconPaths';
import AppIcon from '../icons/AppIcon.vue';
import BinaryCard from './BinaryCard.vue';
import ExtractDialog from './ExtractDialog.vue';
import OpenExternalButton from './OpenExternalButton.vue';
import ViewerFrame from './ViewerFrame.vue';

type Phase = 'loading' | 'ready' | 'failed';

const NO_VALUE = '-';
const ENTRY_ICONS: Record<ArchiveEntry['kind'], IconName> = {
  file: 'document',
  directory: 'folder',
  link: 'link',
  device: 'forbidden',
};

const props = defineProps<{ path: string; probe: FileProbe }>();

const tabs = useTabsStore();
const explorer = useExplorerStore();

const phase = ref<Phase>('loading');
const listing = shallowRef<ArchiveListing | null>(null);
const failure = shallowRef<CommandError | null>(null);
const isExtracting = ref(false);
let listTask = 0;

const fileName = computed(() => fileNameOf(props.path));
const entries = computed(() => listing.value?.entries ?? []);
const failureNotice = computed(
  () => `${ARCHIVE_FAILURE_PREFIX}: ${failure.value?.message ?? ''}`,
);
const statusText = computed(() => {
  const current = listing.value;
  if (!current) return '';
  const count = countLabel(current.entry_count, 'entrada', 'entradas');
  const format = FORMAT_LABELS[current.format];
  return `${format} · ${count} · ${formatSize(current.declared_bytes)} descomprimido`;
});

function sizeText(entry: ArchiveEntry, value: number | null): string {
  if (entry.kind === 'directory' || value === null) return NO_VALUE;
  return formatSize(value);
}

function stateText(entry: ArchiveEntry): string {
  if (entry.skip_reason) return `No se extrae: ${entry.skip_reason}`;
  if (entry.encrypted) return 'Cifrada';
  if (hasHiddenCharacters(entry.name)) return 'Nombre con caracteres ocultos';
  return '';
}

function cancelListing() {
  if (listTask === 0) return;
  void archiveCancel(listTask).catch(() => false);
}

async function load() {
  cancelListing();
  const task = newArchiveTaskId();
  listTask = task;
  phase.value = 'loading';
  try {
    const result = await archiveList(props.path, task);
    if (task !== listTask) return;
    listing.value = result;
    phase.value = 'ready';
  } catch (raw) {
    if (task !== listTask) return;
    failure.value = normalizeError(raw);
    phase.value = 'failed';
  }
}

function openFolder(destination: string) {
  isExtracting.value = false;
  tabs.open(destination);
}

watch(() => props.path, load, { immediate: true });
onBeforeUnmount(cancelListing);
</script>

<template>
  <p v-if="phase === 'loading'" role="status" class="archive-viewer__status">
    {{ ARCHIVE_LISTING_TEXT }}
  </p>
  <BinaryCard
    v-else-if="phase === 'failed'"
    :path="path"
    :probe="probe"
    :notice="failureNotice"
  />
  <ViewerFrame
    v-else-if="listing"
    :title="fileName"
    label="Visor de archivos comprimidos"
    actions-label="Acciones del visor de archivos comprimidos"
  >
    <template #actions>
      <button
        type="button"
        class="btn btn--primary"
        :disabled="listing.encrypted"
        @click="isExtracting = true"
      >
        <AppIcon name="download" />
        Extraer todo…
      </button>
      <OpenExternalButton :path="path" />
    </template>
    <div class="archive-viewer__body">
      <p v-if="listing.encrypted" class="banner banner--warning" role="status">
        {{ ARCHIVE_ENCRYPTED_NOTICE }}
      </p>
      <p v-if="listing.truncated" class="banner banner--warning" role="status">
        {{ ARCHIVE_TRUNCATED_NOTICE }}
      </p>
      <div
        class="archive-viewer__list"
        role="table"
        tabindex="0"
        aria-label="Contenido del archivo comprimido"
        :aria-rowcount="entries.length + 1"
      >
        <div class="archive-viewer__row archive-viewer__head" role="row">
          <span role="columnheader">Nombre</span>
          <span role="columnheader">Tamaño</span>
          <span role="columnheader">Comprimido</span>
          <span role="columnheader">Estado</span>
        </div>
        <div
          v-for="(entry, index) in entries"
          :key="index"
          class="archive-viewer__row archive-viewer__entry"
          :class="{ 'archive-viewer__entry--skipped': entry.skip_reason }"
          role="row"
          :aria-rowindex="index + 2"
        >
          <span class="archive-viewer__name" role="cell">
            <AppIcon :name="ENTRY_ICONS[entry.kind]" />
            <bdi>{{ displayName(entry.name) }}</bdi>
          </span>
          <span role="cell">{{ sizeText(entry, entry.size) }}</span>
          <span role="cell">{{ sizeText(entry, entry.packed) }}</span>
          <span role="cell">{{ stateText(entry) }}</span>
        </div>
      </div>
    </div>
    <template #status>{{ statusText }}</template>
    <ExtractDialog
      v-if="isExtracting"
      :path="path"
      :entry-count="listing.entry_count"
      :declared-bytes="listing.declared_bytes"
      :suspicions="listing.suspicions"
      @close="isExtracting = false"
      @extracted="explorer.reloadAfterChange()"
      @open-folder="openFolder"
    />
  </ViewerFrame>
</template>

<style scoped>
.archive-viewer__status {
  margin: 0;
  color: var(--color-text-muted);
}

.archive-viewer__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-sm);
  min-block-size: 0;
  min-inline-size: 0;
  padding: var(--space-sm);
}

.archive-viewer__list {
  flex: 1;
  min-block-size: 0;
  overflow: auto;
  font-size: var(--font-size-sm);
}

.archive-viewer__row {
  display: grid;
  grid-template-columns:
    minmax(var(--size-column-wide), 1fr) var(--size-column-narrow)
    var(--size-column-narrow) minmax(var(--size-column-medium), 1fr);
  align-items: center;
  gap: var(--space-md);
  padding-inline: var(--space-sm);
}

.archive-viewer__head {
  position: sticky;
  inset-block-start: 0;
  z-index: var(--z-index-shell);
  min-block-size: var(--size-archive-row);
  background-color: var(--color-bg-elevated);
  border-bottom: var(--border-width-sm) solid var(--color-border);
  font-weight: var(--font-weight-bold);
}

.archive-viewer__entry {
  min-block-size: var(--size-archive-row);
  content-visibility: auto;
  contain-intrinsic-size: auto var(--size-archive-row);
}

.archive-viewer__entry--skipped {
  color: var(--color-text-muted);
}

.archive-viewer__name {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.archive-viewer__name bdi {
  font-family: var(--font-family-mono);
}
</style>
