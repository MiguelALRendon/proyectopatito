<script setup lang="ts">
import { computed, watch } from 'vue';
import { useArchiveExtraction } from '../../composables/useArchiveExtraction';
import {
  countLabel,
  displayName,
  isOneDrivePath,
  progressFraction,
  suspicionReasons,
} from '../../documents/archive';
import {
  ARCHIVE_ONEDRIVE_NOTICE,
  ARCHIVE_SKIP_NOTICE,
} from '../../documents/labels';
import { formatSize } from '../../utils/entryDisplay';
import { fileNameOf } from '../../utils/folderPaths';
import BaseModal from '../BaseModal.vue';

const props = defineProps<{
  path: string;
  entryCount: number;
  declaredBytes: number;
  suspicions: readonly string[];
}>();

const emit = defineEmits<{
  close: [];
  extracted: [];
  'open-folder': [destination: string];
}>();

const { phase, progress, report, failure, start, cancel } =
  useArchiveExtraction(() => props.path);

const isRunning = computed(() => phase.value === 'running');
const fileName = computed(() => fileNameOf(props.path));
const isOneDrive = computed(() => isOneDrivePath(props.path));
const reasons = computed(() =>
  suspicionReasons(
    phase.value === 'needs_confirmation'
      ? (failure.value?.codes ?? [])
      : props.suspicions,
  ),
);
const needsConfirmation = computed(
  () => reasons.value.length > 0 && phase.value !== 'done',
);
const fraction = computed(() => progressFraction(progress.value));
const hasTotal = computed(() => (progress.value?.total_bytes ?? 0) > 0);
const progressText = computed(() => {
  const now = progress.value;
  if (!now) return 'Preparando la extracción…';
  const files = countLabel(now.files, 'archivo', 'archivos');
  return `${files} · ${formatSize(now.bytes)} de ${formatSize(now.total_bytes)}`;
});
const skippedCount = computed(
  () => (report.value?.skipped.length ?? 0) + (report.value?.skipped_more ?? 0),
);

watch(phase, (now) => {
  if (now === 'done') emit('extracted');
});

function requestClose() {
  if (!isRunning.value) emit('close');
}

function extract() {
  void start(needsConfirmation.value);
}
</script>

<template>
  <BaseModal
    title-id="extract-dialog-title"
    :close-on-backdrop="!isRunning"
    @close="requestClose"
  >
    <template #title>
      <h2 id="extract-dialog-title">Extraer «{{ displayName(fileName) }}»</h2>
    </template>

    <template v-if="phase === 'idle' || phase === 'needs_confirmation'">
      <p>
        Se extraerá todo el contenido ({{
          countLabel(entryCount, 'entrada', 'entradas')
        }}, {{ formatSize(declaredBytes) }}) a una carpeta nueva junto al
        archivo. El nombre lo elige la aplicación y nunca sobrescribe nada.
      </p>
      <p class="banner banner--warning" role="status">
        {{ ARCHIVE_SKIP_NOTICE }}
      </p>
      <p v-if="isOneDrive" class="banner banner--warning" role="status">
        {{ ARCHIVE_ONEDRIVE_NOTICE }}
      </p>
      <div v-if="needsConfirmation" class="banner banner--warning" role="alert">
        <strong>Este archivo es sospechoso:</strong>
        <ul class="extract-dialog__reasons">
          <li v-for="reason in reasons" :key="reason">{{ reason }}</li>
        </ul>
        <span>Extráelo solo si confías en quien te lo dio.</span>
      </div>
      <div class="extract-dialog__actions">
        <button type="button" class="btn" @click="emit('close')">
          Cancelar
        </button>
        <button type="button" class="btn btn--primary" @click="extract">
          {{ needsConfirmation ? 'Extraer de todos modos' : 'Extraer' }}
        </button>
      </div>
    </template>

    <template v-else-if="phase === 'running'">
      <progress
        class="extract-dialog__progress"
        aria-label="Progreso de la extracción"
        max="1"
        :value="hasTotal ? fraction : undefined"
      ></progress>
      <p role="status">{{ progressText }}</p>
      <div class="extract-dialog__actions">
        <button type="button" class="btn" @click="cancel">
          Cancelar extracción
        </button>
      </div>
    </template>

    <template v-else-if="phase === 'done' && report">
      <p class="banner banner--success" role="status">
        Se extrajeron {{ countLabel(report.files, 'archivo', 'archivos') }} y
        {{ countLabel(report.directories, 'carpeta', 'carpetas') }} ({{
          formatSize(report.bytes)
        }}) en «{{ displayName(report.destination) }}». Aún no están bajo
        control de versiones.
      </p>
      <section v-if="skippedCount > 0" aria-labelledby="extract-skipped-title">
        <h3 id="extract-skipped-title">
          {{ countLabel(skippedCount, 'entrada omitida', 'entradas omitidas') }}
        </h3>
        <ul class="extract-dialog__skipped">
          <li v-for="item in report.skipped" :key="item.name">
            <span class="extract-dialog__name">{{
              displayName(item.name)
            }}</span>
            <span class="extract-dialog__reason">{{ item.reason }}</span>
          </li>
          <li v-if="report.skipped_more > 0">
            y {{ report.skipped_more }} más
          </li>
        </ul>
      </section>
      <div class="extract-dialog__actions">
        <button type="button" class="btn" @click="emit('close')">Cerrar</button>
        <button
          type="button"
          class="btn btn--primary"
          @click="emit('open-folder', report.destination)"
        >
          Abrir carpeta
        </button>
      </div>
    </template>

    <template v-else-if="phase === 'cancelled'">
      <p class="banner banner--success" role="status">
        Extracción cancelada. No quedó nada en el disco.
      </p>
      <div class="extract-dialog__actions">
        <button type="button" class="btn" @click="emit('close')">Cerrar</button>
      </div>
    </template>

    <template v-else>
      <p class="banner banner--error" role="alert">
        {{ failure?.message }}
      </p>
      <div class="extract-dialog__actions">
        <button type="button" class="btn" @click="emit('close')">Cerrar</button>
        <button type="button" class="btn btn--primary" @click="extract">
          Reintentar
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.extract-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-sm);
}

.extract-dialog__progress {
  inline-size: 100%;
  block-size: var(--size-progress-height);
  accent-color: var(--color-primary);
}

.extract-dialog__reasons,
.extract-dialog__skipped {
  margin: 0;
  padding-inline-start: var(--space-lg);
}

.extract-dialog__skipped {
  max-block-size: var(--size-log-max-height);
  overflow-y: auto;
}

.extract-dialog__name {
  font-family: var(--font-family-mono);
  overflow-wrap: anywhere;
  unicode-bidi: isolate;
}

.extract-dialog__reason {
  display: block;
  color: var(--color-text-muted);
}
</style>
