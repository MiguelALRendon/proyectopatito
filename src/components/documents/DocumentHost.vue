<script setup lang="ts">
import { computed, provide, ref, shallowRef, watch } from 'vue';
import { chooseProvider } from '../../documents/registry';
import { DOCUMENT_TAB_KEY } from '../../documents/tabContext';
import { fsProbe, type FileProbe } from '../../services/filesApi';
import { normalizeError, type CommandError } from '../../services/tauri';
import BinaryCard from './BinaryCard.vue';
import CloudOnlyCard from './CloudOnlyCard.vue';

const OPENING_TEXT = 'Abriendo el documento…';
const FAILED_PREFIX = 'No se pudo abrir el archivo';

type Phase = 'probing' | 'ready' | 'failed';

const props = defineProps<{ path: string; tabId: string }>();

provide(DOCUMENT_TAB_KEY, props.tabId);

const phase = ref<Phase>('probing');
const probe = shallowRef<FileProbe | null>(null);
const failure = shallowRef<CommandError | null>(null);
const downloadFailure = shallowRef<CommandError | null>(null);
const isDownloading = ref(false);
let generation = 0;

const provider = computed(() =>
  probe.value ? chooseProvider({ path: props.path, probe: probe.value }) : null,
);
const failureNotice = computed(
  () => `${FAILED_PREFIX}: ${failure.value?.message ?? ''}`,
);

function accept(result: FileProbe) {
  probe.value = result;
  failure.value = null;
  downloadFailure.value = null;
  phase.value = 'ready';
}

function reject(error: CommandError, isDownload: boolean) {
  if (isDownload) {
    downloadFailure.value = error;
    return;
  }
  failure.value = error;
  phase.value = 'failed';
}

async function load(allowDownload: boolean) {
  const current = ++generation;
  try {
    const result = await fsProbe(props.path, allowDownload);
    if (current === generation) accept(result);
  } catch (error) {
    if (current === generation) reject(normalizeError(error), allowDownload);
  }
}

async function open() {
  phase.value = 'probing';
  await load(false);
}

async function download() {
  isDownloading.value = true;
  await load(true);
  isDownloading.value = false;
}

watch(() => props.path, open, { immediate: true });
</script>

<template>
  <p v-if="phase === 'probing'" role="status" class="document-host__status">
    {{ OPENING_TEXT }}
  </p>
  <BinaryCard
    v-else-if="phase === 'failed'"
    :path="path"
    :probe="null"
    :notice="failureNotice"
  >
    <template #actions>
      <button type="button" class="btn" @click="open">Reintentar</button>
    </template>
  </BinaryCard>
  <CloudOnlyCard
    v-else-if="probe?.kind === 'cloud'"
    :path="path"
    :size="probe.len"
    :is-downloading="isDownloading"
    :error="downloadFailure"
    @download="download"
  />
  <component
    :is="provider.component"
    v-else-if="provider && probe"
    :path="path"
    :probe="probe"
    @reprobe="open"
  />
  <BinaryCard v-else :path="path" :probe="probe" />
</template>

<style scoped>
.document-host__status {
  margin: 0;
  color: var(--color-text-muted);
}
</style>
