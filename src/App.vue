<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AboutDialog from './components/AboutDialog.vue';
import ChoiceDialog from './components/ChoiceDialog.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import ExplorerSidebar from './components/explorer/ExplorerSidebar.vue';
import AppShell from './components/shell/AppShell.vue';
import InfoPanel from './components/shell/InfoPanel.vue';
import TabBar from './components/shell/TabBar.vue';
import TabContent from './components/shell/TabContent.vue';
import { useTheme } from './composables/useTheme';
import { useTabsSession } from './composables/useTabsSession';
import { useWindowClose } from './composables/useWindowClose';
import { useWorkspaceStore } from './stores/workspace';
import OnboardingView from './views/OnboardingView.vue';

const workspace = useWorkspaceStore();
const isAboutOpen = ref(false);
const { resolvedTheme, toggleTheme } = useTheme();
useWindowClose();
const isShellVisible = computed(
  () => workspace.isLoaded && workspace.isOnboarded,
);
useTabsSession(isShellVisible);

onMounted(() => workspace.load());
</script>

<template>
  <div class="app">
    <header class="app__header">
      <span class="app__brand">dakedaduck svn</span>
      <div class="app__actions">
        <button type="button" class="btn" @click="isAboutOpen = true">
          Acerca de
        </button>
        <button type="button" class="btn" @click="toggleTheme">
          {{ resolvedTheme === 'dark' ? 'Tema claro' : 'Tema oscuro' }}
        </button>
      </div>
    </header>
    <AppShell v-if="isShellVisible">
      <template #sidebar><ExplorerSidebar /></template>
      <template #tabs><TabBar /></template>
      <template #content><TabContent /></template>
      <template #bottom><InfoPanel /></template>
    </AppShell>
    <main v-else class="app__main" tabindex="-1">
      <p v-if="!workspace.isLoaded" role="status">Cargando…</p>
      <OnboardingView v-else />
    </main>
    <AboutDialog v-if="isAboutOpen" @close="isAboutOpen = false" />
    <ConfirmDialog />
    <ChoiceDialog />
  </div>
</template>
