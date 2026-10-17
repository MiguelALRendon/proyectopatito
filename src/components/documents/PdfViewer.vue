<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { PDF_FAILURE_NOTICES } from '../../documents/labels';
import type {
  PdfFailure,
  PdfHandle,
  PdfRender,
} from '../../documents/pdf/loader';
import {
  clampPage,
  fitWidthZoom,
  formatZoom,
  parsePageInput,
  stepZoom,
  type PageSize,
} from '../../documents/pdfView';
import { fileUrl, type FileProbe } from '../../services/filesApi';
import { fileNameOf } from '../../utils/folderPaths';
import AppIcon from '../icons/AppIcon.vue';
import BinaryCard from './BinaryCard.vue';
import ViewerFrame from './ViewerFrame.vue';

type Phase = 'loading' | 'ready' | 'failed';
type ZoomMode = 'fit' | 'manual';

const LOADING_TEXT = 'Abriendo el PDF…';
const STAGE_PADDING = 32;
const FIRST_PAGE = 1;

const props = defineProps<{ path: string; probe: FileProbe }>();

const phase = ref<Phase>('loading');
const failure = ref<PdfFailure>('damaged');
const handle = shallowRef<PdfHandle | null>(null);
const page = ref(FIRST_PAGE);
const pageText = ref(String(FIRST_PAGE));
const zoomMode = ref<ZoomMode>('manual');
const manualZoom = ref(1);
const stageWidth = ref(0);
const pageSize = ref<PageSize | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const stage = ref<HTMLElement | null>(null);
let running: PdfRender | null = null;
let ticket = 0;
let openTicket = 0;
let observer: ResizeObserver | null = null;

const fileName = computed(() => fileNameOf(props.path));
const pageCount = computed(() => handle.value?.pageCount ?? 0);
const zoom = computed(() => {
  if (zoomMode.value === 'manual' || !pageSize.value) return manualZoom.value;
  return fitWidthZoom(stageWidth.value - STAGE_PADDING, pageSize.value.width);
});
const zoomLabel = computed(() => formatZoom(zoom.value));
const failureNotice = computed(() => PDF_FAILURE_NOTICES[failure.value]);
const canGoBack = computed(() => page.value > FIRST_PAGE);
const canGoForward = computed(() => page.value < pageCount.value);

async function startRender(current: PdfHandle, mine: number) {
  const size = await current.pageSize(page.value);
  if (mine !== ticket || !canvas.value) return;
  pageSize.value = size;
  running = current.render({
    page: page.value,
    scale: zoom.value,
    canvas: canvas.value,
  });
  await running.done.catch(() => (phase.value = 'failed'));
}

async function draw() {
  const mine = ++ticket;
  running?.cancel();
  await running?.done.catch(() => undefined);
  const current = handle.value;
  if (!current || phase.value !== 'ready' || mine !== ticket) return;
  await startRender(current, mine);
}

function goTo(target: number) {
  page.value = clampPage(target, pageCount.value);
  pageText.value = String(page.value);
}

function commitPageInput() {
  const parsed = parsePageInput(pageText.value, pageCount.value);
  goTo(parsed ?? page.value);
}

function zoomBy(direction: 1 | -1) {
  manualZoom.value = stepZoom(zoom.value, direction);
  zoomMode.value = 'manual';
}

function onKeydown(event: KeyboardEvent) {
  const actions: Record<string, () => void> = {
    PageDown: () => goTo(page.value + 1),
    PageUp: () => goTo(page.value - 1),
    Home: () => goTo(FIRST_PAGE),
    End: () => goTo(pageCount.value),
    '+': () => zoomBy(1),
    '-': () => zoomBy(-1),
  };
  const action = actions[event.key];
  if (!action || event.ctrlKey || event.altKey) return;
  event.preventDefault();
  action();
}

async function show(opened: PdfHandle) {
  handle.value = opened;
  phase.value = 'ready';
  await nextTick();
  await draw();
}

async function open() {
  const mine = ++openTicket;
  phase.value = 'loading';
  const loader = await import('../../documents/pdf/loader');
  if (mine !== openTicket) return;
  try {
    const opened = await loader.openPdf(fileUrl(props.path));
    if (mine === openTicket) await show(opened);
    else await opened.destroy();
  } catch (error) {
    if (mine !== openTicket) return;
    failure.value = loader.failureOf(error);
    phase.value = 'failed';
  }
}

function watchStage() {
  if (!stage.value || typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(([entry]) => {
    stageWidth.value = entry.contentRect.width;
  });
  observer.observe(stage.value);
}

watch([page, zoom], draw);
watch(
  () => props.path,
  () => {
    void handle.value?.destroy();
    handle.value = null;
    goTo(FIRST_PAGE);
    void open();
  },
);
onMounted(() => {
  void open();
  watchStage();
});
onBeforeUnmount(() => {
  openTicket += 1;
  running?.cancel();
  observer?.disconnect();
  void handle.value?.destroy();
});
</script>

<template>
  <p v-if="phase === 'loading'" role="status" class="pdf-viewer__status">
    {{ LOADING_TEXT }}
  </p>
  <BinaryCard
    v-else-if="phase === 'failed'"
    :path="path"
    :probe="probe"
    :notice="failureNotice"
  />
  <ViewerFrame
    v-show="phase === 'ready'"
    :title="fileName"
    label="Visor de PDF"
    actions-label="Acciones del visor de PDF"
  >
    <template #actions>
      <button
        type="button"
        class="btn btn--pill"
        aria-label="Página anterior"
        title="Página anterior"
        :disabled="!canGoBack"
        @click="goTo(page - 1)"
      >
        <AppIcon name="back" />
      </button>
      <label class="pdf-viewer__page">
        <span>Página</span>
        <input
          v-model="pageText"
          class="field__input pdf-viewer__page-input"
          inputmode="numeric"
          aria-label="Número de página"
          @change="commitPageInput"
          @keydown.enter.prevent="commitPageInput"
        />
        <span>de {{ pageCount }}</span>
      </label>
      <button
        type="button"
        class="btn btn--pill"
        aria-label="Página siguiente"
        title="Página siguiente"
        :disabled="!canGoForward"
        @click="goTo(page + 1)"
      >
        <AppIcon name="forward" />
      </button>
      <button
        type="button"
        class="btn btn--pill"
        aria-label="Alejar"
        title="Alejar"
        @click="zoomBy(-1)"
      >
        <AppIcon name="minus" />
      </button>
      <span class="pdf-viewer__zoom" role="status" aria-label="Zoom actual">
        {{ zoomLabel }}
      </span>
      <button
        type="button"
        class="btn btn--pill"
        aria-label="Acercar"
        title="Acercar"
        @click="zoomBy(1)"
      >
        <AppIcon name="add" />
      </button>
      <button
        type="button"
        class="btn btn--pill"
        :aria-pressed="zoomMode === 'fit'"
        @click="zoomMode = 'fit'"
      >
        Ajustar al ancho
      </button>
    </template>
    <div
      ref="stage"
      class="pdf-viewer__stage"
      role="region"
      :aria-label="`Páginas de ${fileName}`"
      tabindex="0"
      @keydown="onKeydown"
    >
      <canvas
        ref="canvas"
        class="pdf-viewer__canvas"
        role="img"
        :aria-label="`Página ${page} de ${pageCount}`"
      ></canvas>
    </div>
    <template #status>
      <span role="status">
        Página {{ page }} de {{ pageCount }} · {{ zoomLabel }}
      </span>
    </template>
  </ViewerFrame>
</template>

<style scoped>
.pdf-viewer__status {
  margin: 0;
  color: var(--color-text-muted);
}

.pdf-viewer__page {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
}

.pdf-viewer__page-input {
  inline-size: var(--size-page-input);
  min-block-size: 0;
  padding: var(--space-xs) var(--space-sm);
  text-align: center;
}

.pdf-viewer__zoom {
  min-inline-size: var(--size-page-input);
  text-align: center;
}

.pdf-viewer__stage {
  display: flex;
  flex: 1;
  min-block-size: 0;
  min-inline-size: 0;
  padding: var(--space-md);
  overflow: auto;
  background-color: var(--color-bg-elevated);
}

.pdf-viewer__canvas {
  flex: none;
  margin: auto;
  background-color: var(--color-bg);
  box-shadow: var(--shadow-clay);
}
</style>
