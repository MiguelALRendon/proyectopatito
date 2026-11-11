<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';
import SvnWarning from './SvnWarning.vue';

const workspace = useWorkspaceStore();
const isBundled = computed(() => workspace.svn?.binary?.origin === 'bundled');
</script>

<template>
  <template v-if="workspace.hasSvn">
    <p class="notice">
      {{
        isBundled
          ? `Subversion incluido (versión ${workspace.svnVersion}).`
          : `Subversion ${workspace.svnVersion} detectado.`
      }}
    </p>
    <SvnWarning />
    <p v-if="workspace.svn?.error" class="banner banner--warning" role="alert">
      {{ workspace.svn.error }}
    </p>
  </template>
  <div v-else class="banner banner--error" role="alert">
    <strong>Subversion no detectado</strong>
    <span>{{
      workspace.svn?.error ?? 'Indica la ruta de svn.exe para continuar.'
    }}</span>
  </div>
</template>

<style scoped>
.notice {
  margin: 0;
  color: var(--color-success);
  font-weight: var(--font-weight-bold);
}
</style>
