<script setup lang="ts">
import { computed, watch } from 'vue';
import { useExplorerStore } from '../../stores/explorer';
import { useProjectStore } from '../../stores/project';
import { useWorkspaceStore } from '../../stores/workspace';
import { isUnderOneDrive } from '../../utils/folderPaths';
import SvnWarning from '../SvnWarning.vue';
import ProjectPanel from '../../views/ProjectPanel.vue';

const ONEDRIVE_NOTICE =
  'Esta copia de trabajo está dentro de una carpeta de OneDrive: consultar su estado puede descargar archivos que solo están en la nube.';

const explorer = useExplorerStore();
const project = useProjectStore();
const workspace = useWorkspaceStore();

const copyRoot = computed(() => explorer.activeWc?.root ?? null);
const isOnOneDrive = computed(() => {
  if (copyRoot.value === null || !workspace.root) return false;
  return isUnderOneDrive(`${workspace.root}\\${copyRoot.value}`);
});

let attempt = '';

function openPendingCopy(): void {
  if (project.isLocked) return;
  const root = copyRoot.value;
  if (root === null || project.path === root) {
    attempt = '';
    return;
  }
  const request = `${root}|${project.finishedOperations}`;
  if (request === attempt) return;
  attempt = request;
  void project.open(root);
}

watch(
  [copyRoot, () => project.isLocked, () => project.finishedOperations],
  openPendingCopy,
  { immediate: true },
);
</script>

<template>
  <div class="info-panel">
    <p v-if="isOnOneDrive" class="banner banner--warning" role="status">
      {{ ONEDRIVE_NOTICE }}
    </p>
    <SvnWarning />
    <ProjectPanel :copy-root="copyRoot" />
  </div>
</template>

<style scoped>
.info-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
</style>
