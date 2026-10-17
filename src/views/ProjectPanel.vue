<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import CheckoutForm from '../components/CheckoutForm.vue';
import CommitModal from '../components/CommitModal.vue';
import CredentialsModal from '../components/CredentialsModal.vue';
import ErrorBanner from '../components/ErrorBanner.vue';
import ProgressLog from '../components/ProgressLog.vue';
import StatusTable from '../components/StatusTable.vue';
import { confirm, resolveConfirm } from '../composables/useConfirm';
import type { Credentials } from '../services/tauri';
import { useProjectStore } from '../stores/project';
import { formatDate } from '../utils/svnLabels';

const props = defineProps<{ copyRoot: string | null }>();

const project = useProjectStore();

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

const isCopyShown = computed(
  () => props.copyRoot !== null && project.path === props.copyRoot,
);
const unreadRoot = computed(() => {
  const isUnread = props.copyRoot !== null && project.path !== props.copyRoot;
  return isUnread && project.error ? props.copyRoot : null;
});
const isLockedError = computed(
  () => project.error?.kind === 'working_copy_locked',
);

const lastChangedDate = computed(() => {
  const iso = project.info?.last_changed_date;
  return iso ? formatDate(iso) : '-';
});

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
  <section class="project-panel" aria-label="Copia de trabajo">
    <ErrorBanner
      v-if="project.error"
      class="project-panel__wide"
      :error="project.error"
    >
      <button
        v-if="project.error.kind === 'auth_required'"
        type="button"
        class="btn"
        @click="isCredentialsOpen = true"
      >
        Introducir credenciales
      </button>
      <button
        v-if="isLockedError && unreadRoot !== null"
        type="button"
        class="btn btn--primary"
        :disabled="project.isLocked"
        @click="project.cleanup(unreadRoot ?? undefined)"
      >
        Cleanup
      </button>
    </ErrorBanner>
    <ProgressLog
      class="project-panel__wide"
      :lines="project.progressLines"
      :is-running="project.isBusy"
    />
    <div v-if="project.isBusy" class="actions project-panel__wide">
      <button
        type="button"
        class="btn btn--danger"
        :disabled="project.operation?.id == null"
        @click="cancelOperation"
      >
        Cancelar operación
      </button>
    </div>
    <p
      v-if="project.wasCancelled"
      class="banner banner--warning project-panel__wide"
      role="status"
    >
      La última operación fue cancelada.
      <template v-if="project.canCleanup">
        Ejecuta Cleanup antes de continuar.
      </template>
    </p>

    <div v-if="isCopyShown" class="card">
      <h2>Copia de trabajo</h2>
      <dl class="project-panel__info">
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
          :disabled="project.isLocked"
          @click="project.update()"
        >
          Actualizar
        </button>
        <button
          type="button"
          class="btn"
          :disabled="project.isLocked"
          @click="isCommitOpen = true"
        >
          Confirmar
        </button>
        <button
          type="button"
          class="btn"
          :disabled="project.isLocked"
          @click="project.refresh()"
        >
          Refrescar estado
        </button>
        <button
          v-if="project.canCleanup"
          type="button"
          class="btn"
          :class="{ 'btn--primary': isLockedError }"
          :disabled="project.isLocked"
          @click="project.cleanup()"
        >
          Cleanup
        </button>
      </div>
      <StatusTable v-if="project.status" :report="project.status" />
    </div>
    <p v-else-if="copyRoot === null" class="project-panel__note">
      La carpeta actual no es una copia de trabajo.
    </p>

    <div class="card">
      <h2>Checkout</h2>
      <CheckoutForm
        :is-disabled="project.isLocked"
        @submit="({ url, name }) => project.checkout(url, name)"
      />
    </div>

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
.project-panel {
  display: grid;
  grid-template-columns: repeat(
    auto-fit,
    minmax(var(--size-panel-column-min), 1fr)
  );
  align-items: start;
  gap: var(--space-md);
}

.project-panel__wide {
  grid-column: 1 / -1;
}

.project-panel__note {
  margin: 0;
  color: var(--color-text-muted);
}

.project-panel__info {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-xs) var(--space-md);
  margin: 0;
}

.project-panel__info dt {
  font-weight: var(--font-weight-bold);
}

.project-panel__info dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
