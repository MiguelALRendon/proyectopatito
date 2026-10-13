<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import SvnVersionNotice from '../components/SvnVersionNotice.vue';
import ErrorBanner from '../components/ErrorBanner.vue';
import { pickDirectory, normalizeError } from '../services/tauri';
import { useWorkspaceStore } from '../stores/workspace';

const workspace = useWorkspaceStore();

const rootInput = ref(workspace.root ?? '');
const svnPathInput = ref(workspace.svn?.binary?.path ?? '');
const pickerError = ref<string | null>(null);
const wasRootSubmitted = ref(false);

const trimmedRoot = computed(() => rootInput.value.trim());
const rootError = computed(() =>
  trimmedRoot.value ? null : 'Indica la carpeta raíz del workspace.',
);
const FEEDBACK_MS = 3000;
const SUCCESS_MESSAGES = {
  root: 'Carpeta raíz guardada.',
  svnPath: 'Ruta de svn.exe guardada.',
  detect: 'Detección completada.',
};

type Action = keyof typeof SUCCESS_MESSAGES;

const pendingAction = ref<Action | null>(null);
const succeededAction = ref<Action | null>(null);
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

const rootStatus = computed(() =>
  succeededAction.value === 'root' ? SUCCESS_MESSAGES.root : '',
);
const svnStatus = computed(() =>
  succeededAction.value === 'svnPath' || succeededAction.value === 'detect'
    ? SUCCESS_MESSAGES[succeededAction.value]
    : '',
);

async function runAction(action: Action, task: () => Promise<boolean>) {
  clearTimeout(feedbackTimer);
  succeededAction.value = null;
  pendingAction.value = action;
  const isOk = await task();
  pendingAction.value = null;
  if (!isOk) return;
  succeededAction.value = action;
  feedbackTimer = setTimeout(() => (succeededAction.value = null), FEEDBACK_MS);
}

onBeforeUnmount(() => clearTimeout(feedbackTimer));

async function chooseRoot() {
  pickerError.value = null;
  try {
    const picked = await pickDirectory();
    if (picked) rootInput.value = picked;
  } catch (raw) {
    pickerError.value = normalizeError(raw).message;
  }
}

async function saveRoot() {
  wasRootSubmitted.value = true;
  if (rootError.value) return;
  await runAction('root', () => workspace.setRoot(trimmedRoot.value));
}

async function saveSvnPath() {
  const path = svnPathInput.value.trim();
  if (path) await runAction('svnPath', () => workspace.setSvnPath(path));
}

function detectSvnAgain() {
  return runAction('detect', () => workspace.detectSvn());
}
</script>

<template>
  <section class="onboarding" aria-labelledby="onboarding-title">
    <h1 id="onboarding-title">Configura dakedaduck svn</h1>

    <form class="card" novalidate @submit.prevent="saveRoot">
      <h2>1. Carpeta raíz del workspace</h2>
      <div class="row">
        <div class="field">
          <label class="field__label" for="workspace-root">Carpeta raíz</label>
          <input
            id="workspace-root"
            v-model="rootInput"
            class="field__input"
            type="text"
            autocomplete="off"
            :aria-invalid="wasRootSubmitted && rootError !== null"
            aria-describedby="workspace-root-error workspace-root-hint"
          />
        </div>
        <button
          type="button"
          class="btn"
          :disabled="pendingAction !== null"
          @click="chooseRoot"
        >
          Elegir carpeta
        </button>
        <button
          type="submit"
          class="btn btn--primary"
          :disabled="pendingAction !== null"
        >
          {{ pendingAction === 'root' ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
      <span id="workspace-root-hint" class="field__hint">
        Todas tus copias de trabajo vivirán dentro de esta carpeta.
      </span>
      <span id="workspace-root-error" class="field__error" role="alert">
        {{ wasRootSubmitted ? rootError : '' }}
      </span>
      <p v-if="pickerError" class="banner banner--error" role="alert">
        {{ pickerError }}
      </p>
      <p v-if="workspace.root" class="onboarding__saved">
        Carpeta raíz del workspace: {{ workspace.root }}
      </p>
      <p class="onboarding__saved" role="status">{{ rootStatus }}</p>
    </form>

    <form class="card" @submit.prevent="saveSvnPath">
      <h2>2. Subversion</h2>
      <SvnVersionNotice />
      <div class="row">
        <div class="field">
          <label class="field__label" for="svn-path">
            Ruta de svn.exe (opcional)
          </label>
          <input
            id="svn-path"
            v-model="svnPathInput"
            class="field__input"
            type="text"
            autocomplete="off"
          />
        </div>
        <button type="submit" class="btn" :disabled="pendingAction !== null">
          {{ pendingAction === 'svnPath' ? 'Guardando…' : 'Usar esta ruta' }}
        </button>
        <button
          type="button"
          class="btn"
          :disabled="pendingAction !== null"
          @click="detectSvnAgain"
        >
          {{ pendingAction === 'detect' ? 'Detectando…' : 'Detectar de nuevo' }}
        </button>
      </div>
      <p class="onboarding__saved" role="status">{{ svnStatus }}</p>
    </form>

    <ErrorBanner v-if="workspace.error" :error="workspace.error" />
  </section>
</template>

<style scoped>
.onboarding__saved {
  margin: 0;
  color: var(--color-success);
  overflow-wrap: anywhere;
}
</style>
