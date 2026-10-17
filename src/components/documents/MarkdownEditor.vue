<script setup lang="ts">
import { computed, ref } from 'vue';
import { useResizablePanel } from '../../composables/useResizablePanel';
import { useDocumentTab } from '../../documents/tabContext';
import type { FileProbe } from '../../services/filesApi';
import { useDocumentsStore } from '../../stores/documents';
import { fileNameOf, parentPath } from '../../utils/folderPaths';
import ResizeHandle from '../shell/ResizeHandle.vue';
import MarkdownPreview from './MarkdownPreview.vue';
import TextEditor from './TextEditor.vue';

type Mode = 'editor' | 'preview' | 'split';

const MODES: { id: Mode; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'preview', label: 'Vista previa' },
  { id: 'split', label: 'Dividido' },
];
const SPLIT_MIN = 240;
const SPLIT_MAX = 1200;
const SPLIT_DEFAULT = 480;

const props = defineProps<{ path: string; probe: FileProbe }>();
const emit = defineEmits<{ reprobe: [] }>();

const tabId = useDocumentTab();
const documents = useDocumentsStore();
const split = useResizablePanel('markdown-split', {
  min: SPLIT_MIN,
  max: SPLIT_MAX,
  default: SPLIT_DEFAULT,
});
const mode = ref<Mode>('editor');

const session = computed(() => documents.sessionOf(tabId));
const isOpen = computed(
  () => session.value?.phase === 'ready' || session.value?.phase === 'saving',
);
const showsEditor = computed(() => mode.value !== 'preview' || !isOpen.value);
const showsPreview = computed(() => mode.value !== 'editor' && isOpen.value);
const isSplit = computed(() => mode.value === 'split' && isOpen.value);
const editorStyle = computed(() =>
  isSplit.value ? { flex: `0 1 ${split.size.value}px` } : null,
);
const baseDirectory = computed(() => parentPath(props.path));
</script>

<template>
  <section class="markdown-editor" :aria-label="`Markdown ${fileNameOf(path)}`">
    <div
      v-if="isOpen"
      class="markdown-editor__modes"
      role="group"
      aria-label="Modo de visualización"
    >
      <button
        v-for="item in MODES"
        :key="item.id"
        type="button"
        class="btn btn--pill"
        :aria-pressed="mode === item.id"
        @click="mode = item.id"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="markdown-editor__panes">
      <TextEditor
        v-show="showsEditor"
        class="markdown-editor__editor"
        :style="editorStyle"
        :path="path"
        :probe="probe"
        @reprobe="emit('reprobe')"
      />
      <ResizeHandle
        v-if="isSplit"
        label="Redimensionar editor y vista previa"
        :value="split.size.value"
        :min="split.min"
        :max="split.max"
        @drag="split.startDrag"
        @nudge="split.nudge"
        @jump="split.jumpTo"
      />
      <MarkdownPreview
        v-if="showsPreview"
        class="markdown-editor__preview"
        :source="session?.current ?? ''"
        :base-directory="baseDirectory"
      />
    </div>
  </section>
</template>

<style scoped>
.markdown-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  block-size: 100%;
  min-block-size: 0;
}

.markdown-editor__modes {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-sm);
}

.markdown-editor__panes {
  display: flex;
  flex: 1;
  min-block-size: 0;
}

.markdown-editor__editor {
  flex: 1;
  min-inline-size: var(--size-split-pane-min-width);
}

.markdown-editor__preview {
  flex: 1;
  min-inline-size: var(--size-split-pane-min-width);
}
</style>
