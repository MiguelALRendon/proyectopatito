<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import {
  BYTE_DIGITS,
  ROW_HEIGHT_PX,
  buildRow,
  chunkIndexesOf,
  spacerHeightOf,
  toHex,
  totalRowsOf,
  windowOf,
} from '../../documents/hex';
import { BYTES_PER_ROW } from '../../documents/limits';
import { useHexChunks } from '../../documents/useHexChunks';

const DEFAULT_VIEWPORT_PX = 400;
const COLUMN_NUMBERS = Array.from({ length: BYTES_PER_ROW }, (_, i) =>
  toHex(i, BYTE_DIGITS),
);
const EMPTY_TEXT = 'El archivo está vacío.';
const ERROR_PREFIX = 'No se pudo leer el archivo';

const props = defineProps<{ path: string; length: number }>();

const chunks = useHexChunks(props.path);
const headId = useId();
const scroller = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(DEFAULT_VIEWPORT_PX);
let observer: ResizeObserver | undefined;

const totalRows = computed(() => totalRowsOf(props.length));
const scrollWindow = computed(() =>
  windowOf({
    scrollTop: scrollTop.value,
    viewportHeight: viewportHeight.value,
    totalRows: totalRows.value,
  }),
);
const rows = computed(() => {
  void chunks.revision.value;
  const { firstRow, rowCount } = scrollWindow.value;
  return Array.from({ length: rowCount }, (_, i) =>
    buildRow(firstRow + i, props.length, chunks.byteAt),
  );
});
const rootStyle = computed(() => ({
  '--hex-row-height': `${ROW_HEIGHT_PX}px`,
}));
const spacerStyle = computed(() => ({
  blockSize: `${spacerHeightOf(totalRows.value)}px`,
}));
const rowsStyle = computed(() => ({
  blockSize: `${viewportHeight.value}px`,
}));

watch(scrollWindow, (window) => chunks.ensure(chunkIndexesOf(window)), {
  immediate: true,
});

function measure() {
  const height = scroller.value?.clientHeight ?? 0;
  if (height > 0) viewportHeight.value = height;
}

function onScroll() {
  scrollTop.value = scroller.value?.scrollTop ?? 0;
}

onMounted(() => {
  measure();
  if (typeof ResizeObserver === 'undefined' || !scroller.value) return;
  observer = new ResizeObserver(measure);
  observer.observe(scroller.value);
});

onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <section class="hex-viewer" :style="rootStyle">
    <p v-if="length === 0" class="hex-viewer__empty">{{ EMPTY_TEXT }}</p>
    <div v-else class="hex-viewer__table">
      <div :id="headId" class="hex-viewer__head" role="row">
        <span class="hex-viewer__offset" role="columnheader">Posición</span>
        <span class="hex-viewer__bytes" role="columnheader">
          <span v-for="number in COLUMN_NUMBERS" :key="number">{{
            number
          }}</span>
        </span>
        <span class="hex-viewer__ascii" role="columnheader">Texto</span>
      </div>
      <div
        ref="scroller"
        class="hex-viewer__scroller"
        role="table"
        tabindex="0"
        aria-label="Contenido hexadecimal, solo lectura"
        :aria-owns="headId"
        :aria-rowcount="totalRows"
        @scroll.passive="onScroll"
      >
        <div class="hex-viewer__spacer" :style="spacerStyle">
          <div class="hex-viewer__rows" role="rowgroup" :style="rowsStyle">
            <div
              v-for="row in rows"
              :key="row.index"
              class="hex-viewer__row"
              role="row"
              :aria-rowindex="row.index + 1"
            >
              <span class="hex-viewer__offset" role="rowheader">{{
                row.offset
              }}</span>
              <span class="hex-viewer__bytes" role="cell">
                <span v-for="(byte, i) in row.bytes" :key="i">{{ byte }}</span>
              </span>
              <span class="hex-viewer__ascii" role="cell">{{ row.ascii }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="chunks.error.value" class="banner banner--error" role="alert">
      <span>{{ ERROR_PREFIX }}: {{ chunks.error.value.message }}</span>
      <button type="button" class="btn" @click="chunks.retry()">
        Reintentar
      </button>
    </div>
  </section>
</template>

<style scoped>
.hex-viewer {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-inline-size: 0;
  min-block-size: 0;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
}

.hex-viewer__empty {
  margin: 0;
  color: var(--color-text-muted);
}

.hex-viewer__table {
  display: flex;
  flex-direction: column;
  min-block-size: 0;
  overflow: hidden;
  border-radius: var(--radius-md);
  background-color: var(--color-bg);
  box-shadow: var(--shadow-clay);
}

.hex-viewer__head,
.hex-viewer__row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding-inline: var(--space-md);
  white-space: pre;
}

.hex-viewer__head {
  padding-block: var(--space-xs);
  background-color: var(--color-bg-elevated);
  border-bottom: var(--border-width-sm) solid var(--color-border);
  color: var(--color-text-muted);
}

.hex-viewer__row {
  block-size: var(--hex-row-height);
  color: var(--color-text);
}

.hex-viewer__offset {
  flex: none;
  inline-size: 9ch;
  color: var(--color-primary);
}

.hex-viewer__bytes {
  display: flex;
  flex: none;
  gap: 1ch;
}

.hex-viewer__bytes > span {
  inline-size: 2ch;
  text-align: center;
}

.hex-viewer__ascii {
  flex: none;
  inline-size: 16ch;
  color: var(--color-text-muted);
}

.hex-viewer__scroller {
  flex: 1;
  min-block-size: 0;
  max-block-size: 60vh;
  overflow: auto;
}

.hex-viewer__scroller:focus-visible {
  outline-offset: calc(-1 * var(--border-width-lg));
}

.hex-viewer__rows {
  position: sticky;
  inset-block-start: 0;
  overflow: hidden;
}
</style>
