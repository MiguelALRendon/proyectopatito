<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Credentials } from '../../services/tauri';
import { useExplorerStore } from '../../stores/explorer';
import { useFavoritesStore } from '../../stores/favorites';
import { useTabsStore } from '../../stores/tabs';
import { errorGuidance } from '../../utils/svnLabels';
import CredentialsModal from '../CredentialsModal.vue';
import ErrorBanner from '../ErrorBanner.vue';
import BreadcrumbBar from './BreadcrumbBar.vue';
import ExplorerToolbar from './ExplorerToolbar.vue';
import FileGrid from './FileGrid.vue';
import FileList from './FileList.vue';
import StatusNotice from './StatusNotice.vue';
import WcHeader from './WcHeader.vue';

const TRUNCATED_NOTICE =
  'Esta carpeta tiene demasiados elementos: solo se muestran los primeros.';
const EMPTY_NOTICE = 'Esta carpeta está vacía.';
const NO_MATCH_NOTICE = 'Ningún elemento coincide con el filtro.';

const props = defineProps<{ tabId: string }>();

const explorer = useExplorerStore();
const favorites = useFavoritesStore();
const tabs = useTabsStore();

const isCredentialsOpen = ref(false);
const state = computed(() => explorer.stateOf(props.tabId));
const entries = computed(() => explorer.visibleOf(props.tabId));
const badges = computed(() =>
  explorer.statusBadges(props.tabId, entries.value),
);
const canCheckServer = computed(
  () => (state.value?.listing?.wc ?? null) !== null,
);
const selected = computed({
  get: () => state.value?.selection ?? [],
  set: (names: string[]) => explorer.select(props.tabId, names),
});
const emptyNotice = computed(() => {
  const hasEntries = (state.value?.listing?.entries.length ?? 0) > 0;
  return hasEntries ? NO_MATCH_NOTICE : EMPTY_NOTICE;
});

watch(
  () => state.value?.status?.error,
  (error) => {
    if (error?.kind === 'auth_required') isCredentialsOpen.value = true;
  },
);

async function submitCredentials(credentials: Credentials) {
  isCredentialsOpen.value = false;
  await explorer.checkServer(props.tabId, credentials);
}

watch(
  () => props.tabId,
  (id) => {
    const tab = tabs.tabs.find((candidate) => candidate.id === id);
    if (tab) void explorer.attach(id, tab.path);
  },
  { immediate: true },
);
</script>

<template>
  <section
    v-if="state"
    class="folder-explorer"
    aria-label="Explorador de archivos"
    :aria-busy="state.isLoading"
  >
    <ExplorerToolbar
      :view="state.view"
      :filter="state.filter"
      :show-hidden="state.showHidden"
      :can-go-back="state.back.length > 0"
      :can-go-forward="state.forward.length > 0"
      :can-go-up="state.location !== ''"
      :is-loading="state.isLoading"
      :is-favorite="favorites.isFavorite(state.location)"
      :can-check-server="canCheckServer"
      :is-checking-server="state.status?.isCheckingServer ?? false"
      @back="explorer.goBack(tabId)"
      @forward="explorer.goForward(tabId)"
      @up="explorer.goUp(tabId)"
      @refresh="explorer.reload(tabId)"
      @toggle-hidden="explorer.toggleHidden(tabId)"
      @toggle-favorite="favorites.toggle(state.location)"
      @check-server="explorer.checkServer(tabId)"
      @toggle-column="explorer.toggleColumn(tabId, $event)"
      @change-view="explorer.updateView(tabId, $event)"
      @update:filter="explorer.setFilter(tabId, $event)"
    />
    <BreadcrumbBar
      :path="state.location"
      @navigate="(path, inNewTab) => explorer.openPath(tabId, path, inNewTab)"
    />
    <WcHeader v-if="state.listing" :header="state.header" />
    <StatusNotice
      v-if="state.status"
      :status="state.status"
      :header-error-kind="state.header?.error?.kind ?? null"
      @ask-credentials="isCredentialsOpen = true"
    />
    <ErrorBanner v-if="state.error" :error="state.error" />
    <p
      v-if="state.listing?.truncated"
      class="banner banner--warning"
      role="status"
    >
      {{ TRUNCATED_NOTICE }}
    </p>
    <p v-if="!state.listing && state.isLoading" role="status">Cargando…</p>
    <p
      v-else-if="state.listing && entries.length === 0"
      class="folder-explorer__empty"
      role="status"
    >
      {{ emptyNotice }}
    </p>
    <FileGrid
      v-else-if="state.view.mode === 'grid'"
      :key="state.location"
      v-model:selected="selected"
      :entries="entries"
      :badges="badges"
      @open="(name, inNewTab) => explorer.openEntry(tabId, name, inNewTab)"
    />
    <FileList
      v-else
      :key="state.location"
      v-model:selected="selected"
      :entries="entries"
      :columns="state.view.columns"
      :mode="state.view.mode"
      :sort="state.view.sort"
      :direction="state.view.sort_direction"
      :badges="badges"
      @open="(name, inNewTab) => explorer.openEntry(tabId, name, inNewTab)"
      @sort="explorer.sortBy(tabId, $event)"
    />
    <CredentialsModal
      v-if="isCredentialsOpen"
      :message="errorGuidance('auth_required') ?? ''"
      @close="isCredentialsOpen = false"
      @submit="submitCredentials"
    />
  </section>
</template>

<style scoped>
.folder-explorer {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  inline-size: 100%;
}

.folder-explorer__empty {
  margin: 0;
  padding: var(--space-md);
  color: var(--color-text-muted);
}
</style>
