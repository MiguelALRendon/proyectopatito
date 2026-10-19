<script setup lang="ts">
import { computed, ref } from 'vue';
import { TOO_LARGE_NOTICE } from '../../documents/labels';
import { isTooLarge } from '../../documents/limits';
import { pathExtension } from '../../documents/registry';
import type { FileProbe, ProbeKind } from '../../services/filesApi';
import { formatSize } from '../../utils/entryDisplay';
import { fileNameOf } from '../../utils/folderPaths';
import AppIcon from '../icons/AppIcon.vue';
import HexViewer from './HexViewer.vue';
import OpenExternalButton from './OpenExternalButton.vue';

const KIND_LABELS: Record<ProbeKind, string> = {
  text: 'Texto',
  image: 'Imagen',
  pdf: 'Documento PDF',
  office: 'Documento de Office',
  audio: 'Audio',
  video: 'Vídeo',
  archive: 'Archivo comprimido',
  binary: 'Archivo binario',
  cloud: 'Solo en la nube',
};
const TEXT_LIKE_EXTENSIONS = ['md', 'txt'];
const NOT_TEXT_NOTICE =
  'Aunque su nombre sugiere texto, el contenido no lo es: se muestra como binario y nunca se interpreta como texto.';
const HEX_PANEL_ID = 'binary-card-hex';
const BYTES_FORMATTER = new Intl.NumberFormat('es');

const props = defineProps<{
  path: string;
  probe: FileProbe | null;
  notice?: string;
  extraFacts?: [string, string][];
}>();

const isHexVisible = ref(false);
const fileName = computed(() => fileNameOf(props.path));
const kindLabel = computed(() => {
  const kind = props.probe ? KIND_LABELS[props.probe.kind] : null;
  const extension = pathExtension(props.path);
  return extension && kind ? `${kind} (.${extension})` : (kind ?? null);
});
const sizeLabel = computed(() => {
  const length = props.probe?.len;
  if (length === undefined) return null;
  return `${formatSize(length)} (${BYTES_FORMATTER.format(length)} bytes)`;
});
const noticeText = computed(() => {
  if (props.notice) return props.notice;
  if (!props.probe) return null;
  const { kind } = props.probe;
  if (kind === 'text') return isTooLarge(props.probe) ? TOO_LARGE_NOTICE : null;
  const isNamedLikeText = TEXT_LIKE_EXTENSIONS.includes(
    pathExtension(props.path),
  );
  return kind === 'binary' && isNamedLikeText ? NOT_TEXT_NOTICE : null;
});
</script>

<template>
  <article class="binary-card card" :aria-label="`Archivo ${fileName}`">
    <header class="binary-card__header">
      <AppIcon name="document" class="binary-card__icon" />
      <h2 class="binary-card__title">{{ fileName }}</h2>
    </header>
    <p v-if="noticeText" class="banner banner--warning" role="status">
      {{ noticeText }}
    </p>
    <dl v-if="probe" class="binary-card__facts">
      <dt>Tipo</dt>
      <dd>{{ kindLabel }}</dd>
      <dt>Tamaño</dt>
      <dd>{{ sizeLabel }}</dd>
      <dt>MIME</dt>
      <dd>{{ probe.mime }}</dd>
      <template v-for="[label, value] in extraFacts" :key="label">
        <dt>{{ label }}</dt>
        <dd>{{ value }}</dd>
      </template>
    </dl>
    <div class="binary-card__actions">
      <button
        v-if="probe"
        type="button"
        class="btn"
        :aria-expanded="isHexVisible"
        :aria-controls="isHexVisible ? HEX_PANEL_ID : undefined"
        @click="isHexVisible = !isHexVisible"
      >
        {{ isHexVisible ? 'Ocultar hexadecimal' : 'Mostrar hexadecimal' }}
      </button>
      <OpenExternalButton v-if="probe" :path="path" />
      <slot name="actions" />
    </div>
    <HexViewer
      v-if="probe && isHexVisible"
      :id="HEX_PANEL_ID"
      :key="path"
      :path="path"
      :length="probe.len"
    />
  </article>
</template>

<style scoped>
.binary-card {
  min-inline-size: 0;
}

.binary-card__header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.binary-card__icon {
  inline-size: var(--size-icon-card);
  block-size: var(--size-icon-card);
  color: var(--color-primary);
}

.binary-card__title {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.binary-card__facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-xs) var(--space-md);
  margin: 0;
}

.binary-card__facts dt {
  color: var(--color-text-muted);
}

.binary-card__facts dd {
  margin: 0;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.binary-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.binary-card__actions:empty {
  display: none;
}
</style>
