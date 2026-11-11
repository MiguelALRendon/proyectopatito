<script setup lang="ts">
import { computed } from 'vue';
import { useOfficeStore } from '../../stores/office';
import { useTabsStore } from '../../stores/tabs';
import DocumentHost from '../documents/DocumentHost.vue';
import FolderExplorer from '../explorer/FolderExplorer.vue';
import { TAB_PANEL_ID, tabDomId } from './tabIds';

const tabs = useTabsStore();
const office = useOfficeStore();

const renderedTabs = computed(() =>
  tabs.tabs.filter(
    (tab) => tab.id === tabs.activeTab?.id || tab.id === office.liveTabId,
  ),
);
</script>

<template>
  <div
    v-if="tabs.activeTab"
    :id="TAB_PANEL_ID"
    class="tab-content"
    role="tabpanel"
    :aria-labelledby="tabDomId(tabs.activeTab.id)"
  >
    <div
      v-for="tab in renderedTabs"
      v-show="tab.id === tabs.activeTab.id"
      :key="tab.id"
      class="tab-content__pane"
    >
      <FolderExplorer v-if="tab.kind === 'folder'" :tab-id="tab.id" />
      <DocumentHost v-else :tab-id="tab.id" :path="tab.path" />
    </div>
  </div>
  <p v-else-if="tabs.isRestoring" role="status">Cargando…</p>
  <div v-else class="tab-content__empty">
    <p>No hay pestañas abiertas.</p>
    <button type="button" class="btn" @click="tabs.open('')">
      Abrir Mis archivos
    </button>
  </div>
</template>

<style scoped>
.tab-content {
  block-size: 100%;
  min-block-size: 0;
}

.tab-content__pane {
  block-size: 100%;
  min-block-size: 0;
}

.tab-content__empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-md);
}

.tab-content__empty p {
  margin: 0;
}
</style>
