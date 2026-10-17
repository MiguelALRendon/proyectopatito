<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { confirm } from '../../composables/useConfirm';
import { SCROLL_LOCK_CLASS } from '../../composables/useModalIsolation';
import { useTheme } from '../../composables/useTheme';
import { askConflict } from '../../documents/dialogs';
import {
  MODIFIED_LABEL,
  NOT_TEXT_NOTICE,
  SAVED_LABEL,
  TOO_LARGE_NOTICE,
  describeDocument,
} from '../../documents/labels';
import type {
  CursorPosition,
  Viewer,
  ViewerOptions,
} from '../../documents/monaco/setup';
import { useDocumentTab } from '../../documents/tabContext';
import type { FileProbe } from '../../services/filesApi';
import {
  normalizeError,
  type CommandError,
  type ErrorKind,
} from '../../services/tauri';
import {
  useDocumentsStore,
  type DocumentSession,
} from '../../stores/documents';
import { fileNameOf } from '../../utils/folderPaths';
import AppIcon from '../icons/AppIcon.vue';
import BinaryCard from './BinaryCard.vue';
import EditorNotices from './EditorNotices.vue';

const LOADING_TEXT = 'Cargando el documento…';
const FAILED_PREFIX = 'No se pudo abrir el archivo como texto';
const READ_ONLY_LABEL = 'Solo lectura';
const RELOAD_TITLE = 'Cambios sin guardar';
const RELOAD_LABEL = 'Descartar y recargar';
const RELOAD_MESSAGE =
  'Recargar el archivo descarta los cambios que no has guardado.';
const SAVE_KEY = 's';
const REDIRECTED_KINDS: ErrorKind[] = ['too_large', 'not_text', 'cloud_only'];
const FIRST_POSITION: CursorPosition = { line: 1, column: 1 };

const props = defineProps<{ path: string; probe: FileProbe }>();
const emit = defineEmits<{ reprobe: [] }>();

const tabId = useDocumentTab();
const documents = useDocumentsStore();
const { resolvedTheme } = useTheme();
const surface = ref<HTMLElement | null>(null);
const isViewerReady = ref(false);
const viewerFailure = shallowRef<CommandError | null>(null);
const languageLabel = ref('');
const cursor = ref<CursorPosition>(FIRST_POSITION);
let viewer: Viewer | null = null;
let generation = 0;

const session = computed(() => documents.sessionOf(tabId));
const fileName = computed(() => fileNameOf(props.path));
const phase = computed(() => session.value?.phase ?? 'loading');
const isOpen = computed(
  () => phase.value === 'ready' || phase.value === 'saving',
);
const isLoading = computed(
  () =>
    phase.value === 'loading' ||
    (isOpen.value && !isViewerReady.value && !viewerFailure.value),
);
const loadFailure = computed(() =>
  phase.value === 'failed' ? (session.value?.error ?? null) : null,
);
const unsupportedNotice = computed(() => {
  if (loadFailure.value?.kind === 'too_large') return TOO_LARGE_NOTICE;
  return loadFailure.value?.kind === 'not_text' ? NOT_TEXT_NOTICE : null;
});
const loadBanner = computed(() => {
  const error = loadFailure.value;
  return error && !REDIRECTED_KINDS.includes(error.kind) ? error : null;
});
const shownFailure = computed(() => viewerFailure.value ?? loadBanner.value);
const facts = computed(() => {
  const state = session.value;
  if (!state || !isOpen.value) return null;
  return describeDocument({
    encoding: state.encoding,
    has_bom: state.hasBom,
    eol: state.eol,
    eol_mixed: state.eolMixed,
  });
});
const stateLabel = computed(() =>
  session.value?.isDirty ? MODIFIED_LABEL : SAVED_LABEL,
);
const binaryProbe = computed<FileProbe>(() => ({
  ...props.probe,
  kind: 'binary',
}));

function disposeViewer() {
  viewer?.dispose();
  viewer = null;
  isViewerReady.value = false;
}

function wireViewer(opened: Viewer) {
  opened.onCursorChange((position) => (cursor.value = position));
  opened.onContentChange((content) => documents.edit(tabId, content));
  languageLabel.value = opened.languageLabel;
  documents.rebase(tabId, opened.getContent());
}

function viewerOptions(
  container: HTMLElement,
  state: DocumentSession,
): ViewerOptions {
  return {
    container,
    content: state.current,
    path: props.path,
    label: `Contenido de ${fileName.value}`,
    theme: resolvedTheme.value,
    readOnly: state.isReadOnly,
  };
}

async function attachViewer() {
  const current = ++generation;
  try {
    const { openViewer } = await import('../../documents/monaco/setup');
    const state = session.value;
    if (current !== generation || !state || !surface.value) return;
    disposeViewer();
    viewer = openViewer(viewerOptions(surface.value, state));
    wireViewer(viewer);
    isViewerReady.value = true;
  } catch (error) {
    if (current === generation) viewerFailure.value = normalizeError(error);
  }
}

function replaceContent() {
  const state = session.value;
  if (!viewer || !state) return;
  viewer.setContent(state.current);
  viewer.setReadOnly(state.isReadOnly);
  documents.rebase(tabId, viewer.getContent());
}

async function requestSave() {
  await documents.saveResolvingLineEnding(tabId);
}

async function resolveConflict() {
  const choice = await askConflict(fileName.value);
  documents.dismissConflict(tabId);
  if (choice === 'reload') await documents.reload(tabId);
  if (choice === 'overwrite') await documents.overwrite(tabId);
}

async function requestReload() {
  const isConfirmed =
    !session.value?.isDirty ||
    (await confirm(RELOAD_MESSAGE, RELOAD_LABEL, RELOAD_TITLE));
  if (isConfirmed) await documents.reload(tabId);
}

async function retryOpening() {
  viewerFailure.value = null;
  if (phase.value === 'failed') await documents.load(tabId, props.path);
  else await attachViewer();
}

function onKeydown(event: KeyboardEvent) {
  const isSaveShortcut =
    (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === SAVE_KEY;
  const isDialogOpen = document.body.classList.contains(SCROLL_LOCK_CLASS);
  if (!isSaveShortcut || isDialogOpen) return;
  event.preventDefault();
  void requestSave();
}

watch(resolvedTheme, (theme) => viewer?.setTheme(theme));
watch(() => session.value?.revision, replaceContent);
watch(
  () => session.value?.isReadOnly,
  (isReadOnly) => viewer?.setReadOnly(Boolean(isReadOnly)),
);
watch(
  () => session.value?.hasConflict,
  (hasConflict) => {
    if (hasConflict) void resolveConflict();
  },
  { immediate: true },
);
watch(isOpen, (opened) => {
  if (opened && !viewer) void attachViewer();
});
watch(
  () => loadFailure.value?.kind === 'cloud_only',
  (isCloudOnly) => {
    if (isCloudOnly) emit('reprobe');
  },
  { immediate: true },
);
onMounted(async () => {
  document.addEventListener('keydown', onKeydown);
  await documents.open(tabId, props.path);
  if (isOpen.value && !viewer) await attachViewer();
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  generation += 1;
  disposeViewer();
});
</script>

<template>
  <section class="text-editor" :aria-label="`Editor de ${fileName}`">
    <p v-if="isLoading" class="text-editor__status" role="status">
      {{ LOADING_TEXT }}
    </p>
    <BinaryCard
      v-if="unsupportedNotice"
      :path="path"
      :probe="binaryProbe"
      :notice="unsupportedNotice"
    />
    <div v-if="shownFailure" class="banner banner--error" role="alert">
      <span>{{ FAILED_PREFIX }}: {{ shownFailure.message }}</span>
      <button type="button" class="btn" @click="retryOpening">
        Reintentar
      </button>
    </div>
    <div v-show="isOpen && isViewerReady" class="text-editor__frame">
      <header class="text-editor__toolbar">
        <h2 class="text-editor__title">{{ fileName }}</h2>
        <span
          class="text-editor__chip"
          :class="{ 'text-editor__chip--modified': session?.isDirty }"
        >
          {{ stateLabel }}
        </span>
        <span v-if="session?.isReadOnly" class="text-editor__chip">
          {{ READ_ONLY_LABEL }}
        </span>
        <button
          type="button"
          class="text-editor__save"
          :disabled="!session?.isDirty || phase === 'saving'"
          :aria-busy="phase === 'saving'"
          @click="requestSave"
        >
          <AppIcon name="save" />
          {{ phase === 'saving' ? 'Guardando…' : 'Guardar' }}
        </button>
      </header>
      <EditorNotices
        :is-read-only="Boolean(session?.isReadOnly)"
        :error="isOpen ? (session?.error ?? null) : null"
        @retry="requestSave"
        @reload="requestReload"
      />
      <div ref="surface" class="text-editor__surface"></div>
      <footer
        v-if="facts"
        class="text-editor__bar"
        role="group"
        aria-label="Estado del documento"
      >
        <span>Línea {{ cursor.line }}, columna {{ cursor.column }}</span>
        <span>{{ languageLabel }}</span>
        <span>{{ facts.encoding }}</span>
        <span>{{ facts.bom }}</span>
        <span>{{ facts.eol }}</span>
        <span
          class="text-editor__state"
          :class="{ 'text-editor__state--modified': session?.isDirty }"
        >
          {{ stateLabel }}
        </span>
        <span
          v-if="facts.mixedEolNotice"
          class="text-editor__mixed"
          role="status"
        >
          {{ facts.mixedEolNotice }}
        </span>
      </footer>
    </div>
  </section>
</template>

<style scoped>
.text-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  block-size: 100%;
  min-block-size: 0;
}

.text-editor__status {
  margin: 0;
  color: var(--color-text-muted);
}

.text-editor__frame {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-block-size: 0;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background-color: var(--color-bg);
  box-shadow: var(--shadow-clay);
}

.text-editor__toolbar,
.text-editor__bar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-xs) var(--space-md);
  background-color: var(--color-bg-elevated);
}

.text-editor__toolbar {
  border-bottom: var(--border-width-sm) solid var(--color-border);
}

.text-editor__title {
  min-inline-size: 0;
  overflow: hidden;
  font-size: var(--font-size-base);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text-editor__chip {
  padding: 0 var(--space-sm);
  border-radius: var(--radius-lg);
  background-color: var(--color-bg);
  box-shadow: var(--shadow-clay);
  color: var(--color-success);
  font-size: var(--font-size-sm);
}

.text-editor__chip--modified {
  color: var(--color-conflict-marker);
  font-weight: var(--font-weight-bold);
}

.text-editor__save {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  margin-inline-start: auto;
  padding: var(--space-xs) var(--space-md);
  border: none;
  border-radius: var(--radius-xl);
  background-color: var(--color-primary);
  box-shadow: var(--shadow-clay);
  color: var(--color-bg);
  font: inherit;
  cursor: pointer;
}

.text-editor__save:hover:not(:disabled) {
  background-color: var(--color-primary-hover);
}

.text-editor__save:disabled {
  opacity: var(--opacity-disabled);
  cursor: not-allowed;
}

.text-editor__surface {
  flex: 1;
  min-block-size: var(--size-editor-min-height);
}

.text-editor__bar {
  border-top: var(--border-width-sm) solid var(--color-border);
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
}

.text-editor__state {
  color: var(--color-success);
}

.text-editor__state--modified,
.text-editor__mixed {
  color: var(--color-conflict-marker);
  font-weight: var(--font-weight-bold);
}
</style>
