<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  MODIFIED_LABEL,
  OFFICE_BLOCKED_NOTICE,
  OFFICE_FAILURE_NOTICES,
  OFFICE_MACROS_NOTICE,
  SAVED_LABEL,
} from '../../documents/labels';
import { MAX_OFFICE_BYTES } from '../../documents/limits';
import { pathExtension } from '../../documents/registry';
import {
  failureOf,
  type OfficeFailure,
} from '../../documents/office/officeFailure';
import {
  officeHost,
  type OfficeEvent,
} from '../../documents/office/officeHost';
import {
  isOfficeFormat,
  type OfficeFormat,
  type OfficeKind,
} from '../../documents/office/officeProtocol';
import { isOfficeSupported } from '../../documents/office/officeSupport';
import { useDocumentTab } from '../../documents/tabContext';
import { fileUrl, fsProbe, type FileProbe } from '../../services/filesApi';
import { useOfficeStore } from '../../stores/office';
import { useTabsStore } from '../../stores/tabs';
import { fileNameOf } from '../../utils/folderPaths';
import AppIcon from '../icons/AppIcon.vue';
import BinaryCard from './BinaryCard.vue';
import EditorNotices from './EditorNotices.vue';
import ViewerFrame from './ViewerFrame.vue';

type Phase = 'loading' | 'ready' | 'failed' | 'idle';

const LOADING_TEXT = 'Abriendo el documento…';
const IDLE_TEXT =
  'El visor se cerró para abrir otro documento de Office. Se reabrirá al volver a esta pestaña.';
const READ_ONLY_LABEL = 'Solo lectura';
const SAVING_LABEL = 'Guardando…';
const PERCENT = 100;

const props = defineProps<{ path: string; probe: FileProbe }>();

const tabId = useDocumentTab();
const office = useOfficeStore();
const tabs = useTabsStore();

const phase = ref<Phase>('loading');
const failure = ref<OfficeFailure>('damaged');
const failureDetail = ref('');
const percent = ref(0);
const kind = ref<OfficeKind | null>(null);
const blockedCommand = ref<string | null>(null);
const stage = ref<HTMLElement | null>(null);
let isUnmounted = false;
let openTicket = 0;
let frameOwner: number | null = null;
let unsubscribe: (() => void) | null = null;

const fileName = computed(() => fileNameOf(props.path));
const session = computed(() => office.sessionOf(tabId));
const isActive = computed(() => tabs.activeTab?.id === tabId);
const failureNotice = computed(() => {
  const notice = OFFICE_FAILURE_NOTICES[failure.value];
  return failureDetail.value ? `${notice} (${failureDetail.value})` : notice;
});
const loadingText = computed(() =>
  percent.value > 0 ? `${LOADING_TEXT} ${percent.value} %` : LOADING_TEXT,
);
const stateLabel = computed(() => {
  if (session.value?.isSaving) return SAVING_LABEL;
  return session.value?.isDirty ? MODIFIED_LABEL : SAVED_LABEL;
});

async function readBytes(): Promise<ArrayBuffer> {
  const response = await fetch(fileUrl(props.path));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
}

function fail(reason: OfficeFailure, detail = '') {
  failure.value = reason;
  failureDetail.value = detail;
  phase.value = 'failed';
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function precheck(): OfficeFailure | null {
  if (props.probe.len > MAX_OFFICE_BYTES) return 'tooLarge';
  return isOfficeSupported() ? null : 'unsupported';
}

function onHostEvent(event: OfficeEvent) {
  if (event.cmd === 'blocked') blockedCommand.value = event.command;
  if (event.cmd === 'modified') office.markModified(event.docId);
  if (event.cmd === 'save-requested') {
    void office.saveResolvingConflict(tabId);
  }
  if (event.cmd === 'saved') {
    void office.persistUnrequestedSave(event.docId, event.bytes);
  }
  if (event.cmd !== 'progress' || event.total === 0) return;
  percent.value = Math.floor((event.loaded / event.total) * PERCENT);
}

function isStale(ticket: number): boolean {
  return isUnmounted || ticket !== openTicket;
}

async function openDocument(
  ext: OfficeFormat,
  version: string | null,
  ticket: number,
) {
  if (version === null) throw new Error('El archivo no tiene versión');
  const container = stage.value as HTMLElement;
  const [bytes, owner] = await Promise.all([
    readBytes(),
    officeHost.mount(container),
  ]);
  frameOwner = owner;
  if (isUnmounted) {
    void officeHost.destroyOwned(owner);
    return;
  }
  if (isStale(ticket)) return;
  const docId = crypto.randomUUID();
  const opened = await officeHost.open(docId, ext, bytes);
  if (isStale(ticket)) return;
  kind.value = opened;
  office.attach({ tabId, path: props.path, docId, ext, kind: opened, version });
  phase.value = 'ready';
}

async function handOverToThisTab(): Promise<boolean> {
  if (await office.releaseFor(tabId)) return true;
  phase.value = 'idle';
  if (office.liveTabId) tabs.activate(office.liveTabId);
  return false;
}

async function open() {
  const mine = ++openTicket;
  phase.value = 'loading';
  percent.value = 0;
  const blocked = precheck();
  if (blocked) return fail(blocked);
  const ext = pathExtension(props.path);
  if (!isOfficeFormat(ext)) return fail('damaged');
  if (!(await handOverToThisTab()) || isStale(mine)) return;
  unsubscribe?.();
  unsubscribe = officeHost.subscribe(onHostEvent);
  try {
    await openDocument(ext, props.probe.version, mine);
  } catch (error) {
    if (isUnmounted || mine !== openTicket) return;
    await officeHost.destroy();
    office.detach(tabId);
    fail(failureOf(error), detailOf(error));
  }
}

async function reopenFromDisk() {
  const current = session.value;
  if (!current || phase.value !== 'ready') return;
  const mine = ++openTicket;
  phase.value = 'loading';
  try {
    await officeHost.close(current.docId);
    const fresh = await fsProbe(props.path);
    const ext = pathExtension(props.path);
    if (!isOfficeFormat(ext) || fresh.version === null) {
      throw new Error('El archivo ya no se puede abrir como Office');
    }
    const bytes = await readBytes();
    const docId = crypto.randomUUID();
    const opened = await officeHost.open(docId, ext, bytes);
    if (isUnmounted || mine !== openTicket) return;
    kind.value = opened;
    const version = fresh.version;
    office.attach({
      tabId,
      path: props.path,
      docId,
      ext,
      kind: opened,
      version,
    });
    phase.value = 'ready';
  } catch (error) {
    if (isUnmounted) return;
    await officeHost.destroy();
    office.detach(tabId);
    fail(failureOf(error), detailOf(error));
  }
}

function requestSave() {
  void office.saveResolvingConflict(tabId);
}

function retryReadOnly() {
  void office.save(tabId);
}

watch(
  () => session.value?.reloadTicket,
  (next, previous) => {
    if (next !== undefined && previous !== undefined && next > previous) {
      void reopenFromDisk();
    }
  },
);

watch(session, (current) => {
  const wasReleased = !current && phase.value === 'ready';
  if (wasReleased) phase.value = 'idle';
});

watch(isActive, (active) => {
  if (active && phase.value === 'idle') void open();
});

onMounted(() => void open());
onBeforeUnmount(() => {
  isUnmounted = true;
  unsubscribe?.();
  if (frameOwner === null) return;
  office.detach(tabId);
  void officeHost.destroyOwned(frameOwner);
});
</script>

<template>
  <BinaryCard
    v-if="phase === 'failed'"
    :path="path"
    :probe="probe"
    :notice="failureNotice"
  />
  <ViewerFrame
    v-show="phase !== 'failed'"
    :title="fileName"
    label="Visor de documentos de Office"
    actions-label="Acciones del visor de documentos de Office"
  >
    <template #actions>
      <span
        class="office-viewer__chip"
        :class="{ 'office-viewer__chip--modified': session?.isDirty }"
      >
        {{ stateLabel }}
      </span>
      <span v-if="session?.isReadOnly" class="office-viewer__chip">
        {{ READ_ONLY_LABEL }}
      </span>
      <button
        type="button"
        class="btn btn--pill"
        :disabled="!session?.isDirty || session?.isSaving"
        :aria-busy="session?.isSaving"
        @click="requestSave"
      >
        <AppIcon name="save" />
        Guardar
      </button>
    </template>
    <div class="office-viewer__body" @keydown.ctrl.s.prevent="requestSave">
      <p v-if="probe.has_macros" class="banner banner--warning" role="status">
        {{ OFFICE_MACROS_NOTICE }}
      </p>
      <EditorNotices
        :is-read-only="Boolean(session?.isReadOnly)"
        :error="session?.error ?? null"
        @retry="retryReadOnly"
        @reload="office.reload(tabId)"
      />
      <p
        v-if="blockedCommand"
        class="banner"
        role="status"
        :data-command="blockedCommand"
      >
        {{ OFFICE_BLOCKED_NOTICE }}
      </p>
      <div
        ref="stage"
        class="office-viewer__stage"
        :data-phase="phase"
        :data-kind="kind ?? undefined"
        role="region"
        :aria-label="`Documento ${fileName}`"
      >
        <p
          v-if="phase === 'loading'"
          role="status"
          class="office-viewer__loading"
        >
          {{ loadingText }}
        </p>
        <p
          v-else-if="phase === 'idle'"
          role="status"
          class="office-viewer__loading"
        >
          {{ IDLE_TEXT }}
        </p>
      </div>
    </div>
  </ViewerFrame>
</template>

<style scoped>
.office-viewer__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-block-size: 0;
  min-inline-size: 0;
  overflow: auto;
}

.office-viewer__chip {
  padding: 0 var(--space-sm);
  border-radius: var(--radius-lg);
  background-color: var(--color-bg);
  box-shadow: var(--shadow-clay);
  color: var(--color-success);
  font-size: var(--font-size-sm);
}

.office-viewer__chip--modified {
  color: var(--color-conflict-marker);
  font-weight: var(--font-weight-bold);
}

.office-viewer__stage {
  position: relative;
  display: flex;
  flex: 1 0 auto;
  min-block-size: var(--size-office-min-height);
  min-inline-size: 0;
}

.office-viewer__stage :deep(.office-frame) {
  flex: 1;
  display: block;
  inline-size: 100%;
  min-block-size: 0;
  border: 0;
}

.office-viewer__stage[data-phase='loading'] :deep(.office-frame),
.office-viewer__stage[data-phase='idle'] :deep(.office-frame) {
  visibility: hidden;
}

.office-viewer__loading {
  position: absolute;
  inset: 0;
  display: grid;
  margin: 0;
  place-items: center;
  color: var(--color-text-muted);
}
</style>
