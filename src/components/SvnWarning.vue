<script setup lang="ts">
import { useWorkspaceStore } from '../stores/workspace';

const workspace = useWorkspaceStore();
</script>

<template>
  <p v-if="workspace.svn?.warning" class="banner banner--warning" role="status">
    {{ workspace.svn.warning }}
  </p>
</template>
