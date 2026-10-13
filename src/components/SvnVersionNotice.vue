<script setup lang="ts">
import { useWorkspaceStore } from '../stores/workspace';

const workspace = useWorkspaceStore();
</script>

<template>
  <p v-if="workspace.hasSvn" class="notice">
    Subversion {{ workspace.svnVersion }} detectado.
  </p>
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
