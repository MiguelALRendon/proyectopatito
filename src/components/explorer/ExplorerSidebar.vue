<script setup lang="ts">
import { computed } from 'vue';
import { useExplorerStore } from '../../stores/explorer';
import { useProjectStore } from '../../stores/project';
import { useTabsStore } from '../../stores/tabs';
import { ROOT_FOLDER_LABEL } from '../../utils/folderPaths';
import FavoritesSidebar from './FavoritesSidebar.vue';
import FileTree from './FileTree.vue';

const explorer = useExplorerStore();
const project = useProjectStore();
const tabs = useTabsStore();

const current = computed(() => explorer.activeState?.location ?? '');
const changedFolders = computed(
  () => explorer.activeState?.status?.index?.folders ?? new Set<string>(),
);

async function openFolder(path: string, inNewTab: boolean) {
  const tab = tabs.activeTab;
  if (inNewTab || tab?.kind !== 'folder') tabs.open(path);
  else await explorer.navigate(tab.id, path);
}
</script>

<template>
  <div class="explorer-sidebar">
    <FavoritesSidebar />
    <section class="explorer-sidebar__tree" aria-labelledby="folders-title">
      <h2 id="folders-title" class="explorer-sidebar__title">Carpetas</h2>
      <FileTree
        :root-label="ROOT_FOLDER_LABEL"
        :current="current"
        :load="explorer.listSubfolders"
        :changed-folders="changedFolders"
        :refresh-key="project.finishedOperations"
        @open="openFolder"
      />
    </section>
  </div>
</template>

<style scoped>
.explorer-sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.explorer-sidebar__tree {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.explorer-sidebar__title {
  font-size: var(--font-size-base);
}
</style>
