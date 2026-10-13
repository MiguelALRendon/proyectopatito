<script setup lang="ts">
import { onMounted } from 'vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import { useTheme } from './composables/useTheme';
import { useWorkspaceStore } from './stores/workspace';
import OnboardingView from './views/OnboardingView.vue';
import ProjectPanel from './views/ProjectPanel.vue';

const workspace = useWorkspaceStore();
const { resolvedTheme, toggleTheme } = useTheme();

onMounted(() => workspace.load());
</script>

<template>
  <div class="app">
    <header class="app__header">
      <span class="app__brand">dakedaduck svn</span>
      <button type="button" class="btn" @click="toggleTheme">
        {{ resolvedTheme === 'dark' ? 'Tema claro' : 'Tema oscuro' }}
      </button>
    </header>
    <main class="app__main" tabindex="-1">
      <p v-if="!workspace.isLoaded" role="status">Cargando…</p>
      <ProjectPanel v-else-if="workspace.isOnboarded" />
      <OnboardingView v-else />
    </main>
    <ConfirmDialog />
  </div>
</template>
