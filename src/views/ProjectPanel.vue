<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import CheckoutForm from '../components/CheckoutForm.vue';
import CommitModal from '../components/CommitModal.vue';
import CredentialsModal from '../components/CredentialsModal.vue';
import ErrorBanner from '../components/ErrorBanner.vue';
import ProgressLog from '../components/ProgressLog.vue';
import StatusTable from '../components/StatusTable.vue';
import { confirm, resolveConfirm } from '../composables/useConfirm';
import {
  normalizeError,
  pickDirectory,
  type Credentials,
} from '../services/tauri';
import { useProjectStore } from '../stores/project';
import { formatDate } from '../utils/svnLabels';

const project = useProjectStore();

const openPathInput = ref('');
const pickerError = ref<string | null>(null);
const isCommitOpen = ref(false);
const isCredentialsOpen = ref(false);

watch(
  () => project.error?.kind,
  (kind) => {
    isCredentialsOpen.value = kind === 'auth_required';
  },
);

watch(
  () => project.isBusy,
  (isBusy) => {
    if (!isBusy) resolveConfirm(false);
  },
);

const lastChangedDate = computed(() => {
  const iso = project.info?.last_changed_date;
  return iso ? formatDate(iso) : '-';
});

async function choosePath() {
  pickerError.value = null;
  try {
    const picked = await pickDirectory();
    if (picked) openPathInput.value = picked;
  } catch (raw) {
    pickerError.value = normalizeError(raw).message;
  }
}

async function openWorkingCopy() {
  const path = openPathInput.value.trim();
  if (path) await project.open(path);
}

async function submitCommit(payload: {
  message: string;
  username: string | null;
}) {
  isCommitOpen.value = false;
  await project.commit(payload.message, payload.username);
}

async function submitCredentials(credentials: Credentials) {
  isCredentialsOpen.value = false;
  await project.retryWithCredentials(credentials);
}

async function cancelOperation() {
  const isConfirmed = await confirm(
    'Cancelar la operación puede dejar la copia de trabajo bloqueada hasta ejecutar Cleanup.',
    'Cancelar operación',
    '¿Cancelar la operación?',
  );
  if (isConfirmed) await project.cancel();
}
</script>

<template>
  <section class="panel" aria-labelledby="panel-title">
    <h1 id="panel-title">Proyecto</h1>

    <ErrorBanner v-if="project.error" :error="project.error">
      <button
        v-if="project.error.kind === 'auth_required'"
        type="button"
        class="btn"
        @click="isCredentialsOpen = true"
      >
        Introducir credenciales
      </button>
    </ErrorBanner>
    <ProgressLog :lines="project.progressLines" :is-running="project.isBusy" />
    <div v-if="project.isBusy" class="actions">
      <button
        type="button"
        class="btn btn--danger"
        :disabled="project.operation?.id == null"
        @click="cancelOperation"
      >
        Cancelar operación
      </button>
    </div>

    <div class="card">
      <h2>Checkout</h2>
      <CheckoutForm
        :is-disabled="project.isBusy"
        @submit="({ url, name }) => project.checkout(url, name)"
      />
    </div>

    <form class="card" @submit.prevent="openWorkingCopy">
      <h2>Abrir copia de trabajo</h2>
      <div class="row">
        <div class="field">
          <label class="field__label" for="open-path">
            Ruta de la copia de trabajo
          </label>
          <input
            id="open-path"
            v-model="openPathInput"
            class="field__input"
            type="text"
            autocomplete="off"
          />
        </div>
        <button type="button" class="btn" @click="choosePath">
          Elegir carpeta
        </button>
        <button type="submit" class="btn btn--primary">Abrir</button>
      </div>
      <p v-if="pickerError" class="banner banner--error" role="alert">
        {{ pickerError }}
      </p>
    </form>

    <div v-if="project.path" class="card">
      <h2>Copia de trabajo</h2>
      <dl class="panel__info">
        <dt>Ruta</dt>
        <dd>{{ project.path }}</dd>
        <template v-if="project.info">
          <dt>URL</dt>
          <dd>{{ project.info.url }}</dd>
          <dt>Revisión</dt>
          <dd>{{ project.info.revision }}</dd>
          <dt>Último autor</dt>
          <dd>{{ project.info.last_changed_author ?? '-' }}</dd>
          <dt>Última fecha</dt>
          <dd>{{ lastChangedDate }}</dd>
        </template>
      </dl>
      <div
        class="actions"
        role="group"
        aria-label="Acciones de la copia de trabajo"
      >
        <button
          type="button"
          class="btn btn--primary"
          :disabled="project.isBusy"
          @click="project.update()"
        >
          Actualizar
        </button>
        <button
          type="button"
          class="btn"
          :disabled="project.isBusy"
          @click="isCommitOpen = true"
        >
          Confirmar
        </button>
        <button
          type="button"
          class="btn"
          :disabled="project.isBusy"
          @click="project.refresh()"
        >
          Refrescar estado
        </button>
        <button
          v-if="project.canCleanup"
          type="button"
          class="btn"
          :disabled="project.isBusy"
          @click="project.cleanup()"
        >
          Cleanup
        </button>
      </div>
      <StatusTable v-if="project.status" :report="project.status" />
    </div>

    <p v-if="project.wasCancelled" class="banner banner--warning" role="status">
      La última operación fue cancelada. Ejecuta Cleanup antes de continuar.
    </p>
    <CommitModal
      v-if="isCommitOpen"
      @close="isCommitOpen = false"
      @submit="submitCommit"
    />
    <CredentialsModal
      v-if="isCredentialsOpen && project.error"
      :message="project.error.message"
      @close="isCredentialsOpen = false"
      @submit="submitCredentials"
    />
  </section>
</template>

<style scoped>
.panel__info {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-xs) var(--space-md);
  margin: 0;
}

.panel__info dt {
  font-weight: var(--font-weight-bold);
}

.panel__info dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
