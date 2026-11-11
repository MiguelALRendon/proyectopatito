<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { confirm, useConfirm } from '../../composables/useConfirm';
import {
  marketplaceCertImport,
  marketplaceCertList,
  marketplaceCertRevoke,
  type TrustedCert,
} from '../../services/marketplaceApi';
import { normalizeError, pickFile, type CommandError } from '../../services/tauri';
import { AUTHORITY_FILTERS } from '../../utils/certFilters';
import {
  TRUST_KIND_LABELS,
  certScope,
  formatFingerprint,
  shortFingerprint,
} from '../../utils/certLabels';
import { formatDate } from '../../utils/svnLabels';
import BaseModal from '../BaseModal.vue';
import ErrorBanner from '../ErrorBanner.vue';

const REVOKE_MESSAGE = 'Se dejará de confiar en este certificado.';
const REVOKE_LABEL = 'Revocar';
const REVOKE_TITLE = 'Revocar certificado';
const LOADING_HINT = 'Cargando certificados…';

const emit = defineEmits<{ close: [] }>();

const { message: confirmMessage } = useConfirm();
const certs = ref<TrustedCert[]>([]);
const isLoading = ref(true);
const hasLoaded = ref(false);
const error = ref<CommandError | null>(null);
const notice = ref('');
const importButton = ref<HTMLButtonElement | null>(null);

async function load() {
  isLoading.value = true;
  error.value = null;
  try {
    certs.value = await marketplaceCertList();
    hasLoaded.value = true;
  } catch (raw) {
    error.value = normalizeError(raw);
  } finally {
    isLoading.value = false;
  }
}

onMounted(load);

async function attempt(action: () => Promise<string>): Promise<boolean> {
  error.value = null;
  notice.value = '';
  try {
    notice.value = await action();
    return true;
  } catch (raw) {
    error.value = normalizeError(raw);
    return false;
  }
}

async function revoke(cert: TrustedCert) {
  if (!(await confirm(REVOKE_MESSAGE, REVOKE_LABEL, REVOKE_TITLE))) return;
  const wasRevoked = await attempt(async () => {
    await marketplaceCertRevoke(cert.sha256);
    certs.value = certs.value.filter((item) => item.sha256 !== cert.sha256);
    return `Se revocó la confianza en «${cert.subject}».`;
  });
  if (!wasRevoked) return;
  await nextTick();
  importButton.value?.focus();
}

async function pickAuthority(): Promise<string | null> {
  try {
    return await pickFile(AUTHORITY_FILTERS);
  } catch (raw) {
    error.value = normalizeError(raw);
    return null;
  }
}

async function importAuthority() {
  error.value = null;
  const path = await pickAuthority();
  if (path === null) return;
  await attempt(async () => {
    const added = await marketplaceCertImport(path);
    certs.value = [
      ...certs.value.filter((item) => item.sha256 !== added.sha256),
      added,
    ];
    return `Se importó «${added.subject}».`;
  });
}

function closeUnlessConfirming() {
  if (!confirmMessage.value) emit('close');
}
</script>

<template>
  <BaseModal title-id="certs-title" @close="closeUnlessConfirming">
    <template #title>
      <h2 id="certs-title">Certificados de confianza</h2>
    </template>
    <p class="field__hint">
      Estos son los certificados en los que confías al conectar con servidores
      https. Al revocar uno, se te volverá a preguntar la próxima vez.
    </p>
    <button
      ref="importButton"
      type="button"
      class="btn certs__import"
      @click="importAuthority"
    >
      Importar autoridad…
    </button>
    <div class="certs__status" role="status" aria-live="polite">
      <p v-if="isLoading">{{ LOADING_HINT }}</p>
      <ErrorBanner v-else-if="error" :error="error">
        <button v-if="!hasLoaded" type="button" class="btn" @click="load">
          Reintentar
        </button>
      </ErrorBanner>
      <p v-else-if="notice">{{ notice }}</p>
    </div>
    <p v-if="hasLoaded && certs.length === 0" class="certs__empty">
      Aún no confías en ningún certificado.
    </p>
    <ul
      v-else-if="certs.length"
      class="certs__list"
      aria-label="Certificados de confianza"
    >
      <li v-for="cert in certs" :key="cert.sha256" class="certs__item">
        <div class="certs__head">
          <span class="certs__kind">{{ TRUST_KIND_LABELS[cert.kind] }}</span>
          <strong class="certs__subject">{{ cert.subject }}</strong>
        </div>
        <dl class="certs__facts">
          <dt>Alcance</dt>
          <dd>{{ certScope(cert.scope) }}</dd>
          <dt>Emisor</dt>
          <dd>{{ cert.issuer }}</dd>
          <dt>Huella</dt>
          <dd>
            <code class="certs__fingerprint" :title="formatFingerprint(cert.sha256)">{{
              shortFingerprint(cert.sha256)
            }}</code>
          </dd>
          <dt>Vence</dt>
          <dd>{{ formatDate(cert.not_after) }}</dd>
        </dl>
        <button
          type="button"
          class="btn certs__revoke"
          :aria-label="`Revocar ${cert.subject}`"
          @click="revoke(cert)"
        >
          Revocar
        </button>
      </li>
    </ul>
    <div class="certs__actions">
      <button type="button" class="btn" @click="emit('close')">Cerrar</button>
    </div>
  </BaseModal>
</template>

<style scoped>
.certs__import {
  align-self: flex-start;
}

.certs__status {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.certs__status p,
.certs__empty {
  margin: 0;
}

.certs__empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.certs__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}

.certs__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-md);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-clay);
}

.certs__head {
  display: flex;
  align-items: center;
  align-self: stretch;
  gap: var(--space-sm);
}

.certs__kind {
  flex: none;
  padding: var(--space-xs) var(--space-sm);
  border: var(--border-width-sm) solid var(--color-primary);
  border-radius: var(--radius-xl);
  color: var(--color-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
}

.certs__subject {
  min-width: 0;
  overflow-wrap: anywhere;
}

.certs__facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-xs) var(--space-md);
  align-self: stretch;
  margin: 0;
  font-size: var(--font-size-sm);
}

.certs__facts dt {
  color: var(--color-text-muted);
}

.certs__facts dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.certs__fingerprint {
  font-family: var(--font-family-mono);
}

.certs__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
