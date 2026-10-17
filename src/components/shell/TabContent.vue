<script setup lang="ts">
import { useTabsStore } from '../../stores/tabs';
import DocumentHost from '../documents/DocumentHost.vue';
import FolderExplorer from '../explorer/FolderExplorer.vue';
import { TAB_PANEL_ID, tabDomId } from './tabIds';

const tabs = useTabsStore();
</script>

<template>
  <div
    v-if="tabs.activeTab"
    :id="TAB_PANEL_ID"
    class="tab-content"
    role="tabpanel"
    :aria-labelledby="tabDomId(tabs.activeTab.id)"
  >
    <FolderExplorer
      v-if="tabs.activeTab.kind === 'folder'"
      :key="tabs.activeTab.id"
      :tab-id="tabs.activeTab.id"
    />
    <DocumentHost
      v-else
      :key="tabs.activeTab.id"
      :tab-id="tabs.activeTab.id"
      :path="tabs.activeTab.path"
    />
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
