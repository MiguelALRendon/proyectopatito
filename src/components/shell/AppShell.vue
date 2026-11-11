<script setup lang="ts">
import {
  useResizablePanel,
  type ResizablePanelConfig,
} from '../../composables/useResizablePanel';
import ResizeHandle from './ResizeHandle.vue';
import {
  DEFAULT_SECTION,
  SHELL_SECTIONS,
  type ShellSection,
} from './shellSections';

const SIDEBAR_PANEL: ResizablePanelConfig = {
  min: 160,
  max: 480,
  default: 240,
};
const BOTTOM_PANEL: ResizablePanelConfig = {
  min: 96,
  max: 480,
  default: 160,
  axis: 'y',
  direction: -1,
};

const section = defineModel<ShellSection>('section', {
  default: DEFAULT_SECTION,
});
const sidebar = useResizablePanel('sidebar', SIDEBAR_PANEL);
const bottom = useResizablePanel('bottom', BOTTOM_PANEL);
const { size: sidebarSize, startDrag: dragSidebar } = sidebar;
const { size: bottomSize, startDrag: dragBottom } = bottom;
</script>

<template>
  <div class="shell">
    <nav class="shell__topbar" aria-label="Secciones principales">
      <ul class="shell__nav-list">
        <li v-for="item in SHELL_SECTIONS" :key="item.id">
          <button
            type="button"
            class="shell__nav-item"
            :aria-current="section === item.id ? 'page' : undefined"
            @click="section = item.id"
          >
            {{ item.label }}
          </button>
        </li>
      </ul>
    </nav>
    <div class="shell__body">
      <aside
        class="shell__sidebar"
        aria-label="Barra lateral"
        :style="{ '--shell-sidebar-size': `${sidebarSize}px` }"
      >
        <slot name="sidebar">
          <p class="shell__placeholder">Favoritos y árbol: próximamente.</p>
        </slot>
      </aside>
      <ResizeHandle
        class="shell__handle--sidebar"
        label="Redimensionar la barra lateral"
        :value="sidebarSize"
        :min="sidebar.min"
        :max="sidebar.max"
        @drag="dragSidebar"
        @nudge="sidebar.nudge"
        @jump="sidebar.jumpTo"
      />
      <div class="shell__center">
        <div
          v-if="$slots.tabs"
          v-show="section === 'files'"
          class="shell__tabs"
        >
          <slot name="tabs" />
        </div>
        <main class="shell__content" tabindex="-1">
          <slot name="content" />
        </main>
        <ResizeHandle
          orientation="horizontal"
          label="Redimensionar el panel inferior"
          :value="bottomSize"
          :min="bottom.min"
          :max="bottom.max"
          @drag="dragBottom"
          @nudge="bottom.nudge"
          @jump="bottom.jumpTo"
        />
        <section
          class="shell__bottom"
          aria-label="Panel inferior"
          :style="{ '--shell-bottom-size': `${bottomSize}px` }"
        >
          <slot name="bottom">
            <p class="shell__placeholder">Información: próximamente.</p>
          </slot>
        </section>
      </div>
    </div>
  </div>
</template>
