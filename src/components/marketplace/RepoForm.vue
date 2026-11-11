<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { useCertTrust, type CertStep } from '../../composables/useCertTrust';
import { useClientCertificate } from '../../composables/useClientCertificate';
import type {
  RepoDraft,
  RepoEntry,
  RepoTestArgs,
  RepoTestResult,
} from '../../services/marketplaceApi';
import {
  NO_CREDENTIALS,
  normalizeError,
  type CommandError,
  type Credentials,
} from '../../services/tauri';
import { useMarketplaceStore } from '../../stores/marketplace';
import { errorGuidance } from '../../utils/svnLabels';
import BaseModal from '../BaseModal.vue';
import CredentialsModal from '../CredentialsModal.vue';
import ErrorBanner from '../ErrorBanner.vue';
import CertTrustDialog from './CertTrustDialog.vue';
import { fieldOfSaveError, type RepoField } from './repoFormErrors';

const CACHE_NOTICE =
  'Subversion recordará esta credencial en su caché (la comparten otros clientes como TortoiseSVN). Marca «No recordar la contraseña» para evitarlo.';
const HTTP_NOTICE =
  'Esta conexión no está cifrada: la contraseña viajaría en claro.';
const HTTP_PREFIX = 'http://';
const UUID_PREVIEW_CHARS = 8;
const TRAILING_SLASHES = /\/+$/;

const props = defineProps<{ repo: RepoEntry | null }>();
const emit = defineEmits<{
  close: [];
  saved: [id: number];
}>();

const store = useMarketplaceStore();
const name = ref(props.repo?.name ?? '');
const url = ref(props.repo?.url ?? '');
const username = ref(props.repo?.username ?? '');
const doNotRemember = ref(false);
const fieldErrors = ref<Partial<Record<RepoField, string>>>({});
const isSaving = ref(false);
const isTesting = ref(false);
const testResult = ref<RepoTestResult | null>(null);
const testError = ref<CommandError | null>(null);
const isCredentialsOpen = ref(false);
const {
  prompt: certPrompt,
  isBusy: isTrusting,
  inspect: inspectCert,
  trust: trustCert,
  importAuthority,
  dismiss: dismissCert,
} = useCertTrust();
const {
  path: certPath,
  passphraseError,
  pickError: certPickError,
  choose: chooseCert,
  remove: removeCert,
  wipePassphrase,
  clearPassphraseError,
  validate: validatePassphrase,
  fields: certFields,
} = useClientCertificate(
  props.repo?.client_cert ?? null,
  useTemplateRef<HTMLInputElement>('passphrase'),
);
let testTicket = 0;

const isInsecure = computed(() =>
  url.value.trim().toLowerCase().startsWith(HTTP_PREFIX),
);
const shortUuid = computed(
  () => testResult.value?.uuid.slice(0, UUID_PREVIEW_CHARS) ?? '',
);
const title = computed(() =>
  props.repo ? 'Editar repositorio' : 'Agregar repositorio',
);

const cleanUsername = () => username.value.trim() || null;
const comparableUrl = (value: string) =>
  value.trim().replace(TRAILING_SLASHES, '');

function savedIdFor(candidate: string): number | null {
  const saved = props.repo;
  if (!saved || comparableUrl(saved.url) !== comparableUrl(candidate)) {
    return null;
  }
  return saved.id;
}

function testArgs(credentials: Credentials): RepoTestArgs {
  return {
    url: url.value,
    repo_id: savedIdFor(url.value),
    username: credentials.username ?? cleanUsername(),
    password: credentials.password,
    no_auth_cache: doNotRemember.value,
    ...certFields(),
  };
}

async function startTrust() {
  const ticket = testTicket;
  const failure = await inspectCert(url.value, savedIdFor(url.value));
  if (ticket !== testTicket || failure === null) return;
  testError.value = failure;
  wipePassphrase();
}

async function showTestError(error: CommandError, isRetry: boolean) {
  testError.value = error;
  if (error.kind === 'auth_required') isCredentialsOpen.value = true;
  else if (error.kind === 'untrusted_certificate' && !isRetry) await startTrust();
  else wipePassphrase();
}

function discardTest() {
  testTicket += 1;
  dismissCert();
  isTesting.value = false;
  testResult.value = null;
  testError.value = null;
}

watch([url, username, doNotRemember, certPath], discardTest);
onBeforeUnmount(discardTest);

async function runTest(
  credentials: Credentials = NO_CREDENTIALS,
  isRetry = false,
) {
  if (!validatePassphrase()) return;
  const ticket = ++testTicket;
  isTesting.value = true;
  testResult.value = null;
  testError.value = null;
  const outcome = await store.testConnection(testArgs(credentials));
  if (ticket !== testTicket) return;
  if (outcome.ok) {
    testResult.value = outcome.result;
    wipePassphrase();
  } else await showTestError(outcome.error, isRetry);
  if (ticket === testTicket) isTesting.value = false;
}

function retryWithCredentials(credentials: Credentials) {
  isCredentialsOpen.value = false;
  void runTest(credentials);
}

function cancelCredentials() {
  isCredentialsOpen.value = false;
  wipePassphrase();
}

function cancelCertPrompt() {
  dismissCert();
  wipePassphrase();
}

async function followCertStep(pending: Promise<CertStep>) {
  const ticket = testTicket;
  const step = await pending;
  if (ticket !== testTicket || step.kind === 'idle') return;
  if (step.kind === 'retry') {
    await runTest(NO_CREDENTIALS, true);
    return;
  }
  testError.value = step.error;
  wipePassphrase();
}

function draft(): RepoDraft {
  return {
    id: props.repo?.id ?? null,
    name: name.value,
    url: url.value,
    username: cleanUsername(),
    client_cert: certPath.value,
  };
}

async function showSaveError(error: CommandError) {
  const field = fieldOfSaveError(error);
  fieldErrors.value = { [field]: error.message };
  await nextTick();
  if (field !== 'form') document.getElementById(`repo-form-${field}`)?.focus();
}

async function save() {
  fieldErrors.value = {};
  isSaving.value = true;
  try {
    const saved = await store.save(draft());
    emit('saved', saved.id);
  } catch (raw) {
    await showSaveError(normalizeError(raw));
  } finally {
    isSaving.value = false;
  }
}

function closeUnlessAsking() {
  if (!isCredentialsOpen.value && certPrompt.value === null) emit('close');
}
</script>

<template>
  <BaseModal
    title-id="repo-form-title"
    :close-on-backdrop="false"
    @close="closeUnlessAsking"
  >
    <template #title>
      <h2 id="repo-form-title">{{ title }}</h2>
    </template>
    <form class="repo-form" novalidate @submit.prevent="save">
      <div class="field">
        <label class="field__label" for="repo-form-name">Nombre</label>
        <input
          id="repo-form-name"
          v-model="name"
          class="field__input"
          type="text"
          autocomplete="off"
          :aria-invalid="fieldErrors.name !== undefined"
          aria-describedby="repo-form-name-error"
        />
        <span id="repo-form-name-error" class="field__error" role="alert">
          {{ fieldErrors.name }}
        </span>
      </div>
      <div class="field">
        <label class="field__label" for="repo-form-url">URL</label>
        <input
          id="repo-form-url"
          v-model="url"
          class="field__input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :aria-invalid="fieldErrors.url !== undefined"
          aria-describedby="repo-form-url-error repo-form-url-hint"
        />
        <span id="repo-form-url-hint" class="field__hint">
          Admite http, https, svn y file.
        </span>
        <span id="repo-form-url-error" class="field__error" role="alert">
          {{ fieldErrors.url }}
        </span>
        <div class="repo-form__notice" role="status">
          <p v-if="isInsecure" class="banner banner--warning">
            {{ HTTP_NOTICE }}
          </p>
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="repo-form-username"
          >Usuario (opcional)</label
        >
        <input
          id="repo-form-username"
          v-model="username"
          class="field__input"
          type="text"
          autocomplete="off"
          :aria-invalid="fieldErrors.username !== undefined"
          aria-describedby="repo-form-username-error"
        />
        <span id="repo-form-username-error" class="field__error" role="alert">
          {{ fieldErrors.username }}
        </span>
      </div>
      <label class="repo-form__check">
        <input
          v-model="doNotRemember"
          type="checkbox"
          aria-describedby="repo-form-cache-notice"
        />
        <span>
          No recordar la contraseña
          <span class="field__hint">al probar la conexión</span>
        </span>
      </label>
      <p id="repo-form-cache-notice" class="field__hint">{{ CACHE_NOTICE }}</p>
      <div class="field">
        <label class="field__label" for="repo-form-cert"
          >Certificado de cliente (opcional)</label
        >
        <input
          id="repo-form-cert"
          class="field__input"
          type="text"
          readonly
          placeholder="Ningún archivo elegido"
          :value="certPath ?? ''"
          :title="certPath ?? undefined"
          aria-describedby="repo-form-cert-hint repo-form-cert-error"
        />
        <span id="repo-form-cert-hint" class="field__hint">
          Archivo PKCS#12 (.p12 o .pfx), solo si el servidor lo exige.
        </span>
        <div class="repo-form__cert-actions">
          <button type="button" class="btn" @click="chooseCert">
            Elegir archivo…
          </button>
          <button
            v-if="certPath"
            type="button"
            class="btn"
            aria-label="Quitar el certificado de cliente"
            @click="removeCert"
          >
            Quitar
          </button>
        </div>
        <span id="repo-form-cert-error" class="field__error" role="alert">
          {{ certPickError?.message }}
        </span>
      </div>
      <div v-if="certPath" class="field">
        <label class="field__label" for="repo-form-passphrase"
          >Frase de paso del certificado</label
        >
        <input
          id="repo-form-passphrase"
          ref="passphrase"
          class="field__input"
          type="password"
          autocomplete="off"
          :aria-invalid="passphraseError !== null"
          aria-describedby="repo-form-passphrase-error repo-form-passphrase-hint"
          @input="clearPassphraseError"
        />
        <span id="repo-form-passphrase-hint" class="field__hint">
          La frase no se guarda: se usa solo para probar la conexión.
        </span>
        <span id="repo-form-passphrase-error" class="field__error" role="alert">
          {{ passphraseError }}
        </span>
      </div>
      <div class="repo-form__test">
        <button
          type="button"
          class="btn"
          :disabled="isTesting"
          :aria-busy="isTesting"
          @click="runTest()"
        >
          {{ isTesting ? 'Probando…' : 'Probar conexión' }}
        </button>
        <div class="repo-form__test-status" role="status" aria-live="polite">
          <p v-if="isTesting">Probando la conexión…</p>
          <div v-else-if="testResult" class="banner banner--success">
            <strong>Conexión correcta</strong>
            <span>Identificador del repositorio: {{ shortUuid }}</span>
            <span>Raíz: {{ testResult.root }}</span>
          </div>
          <ErrorBanner v-else-if="testError" :error="testError" />
        </div>
      </div>
      <p v-if="fieldErrors.form" class="field__error" role="alert">
        {{ fieldErrors.form }}
      </p>
      <div class="repo-form__actions">
        <button type="button" class="btn" @click="emit('close')">
          Cancelar
        </button>
        <button type="submit" class="btn btn--primary" :disabled="isSaving">
          Guardar
        </button>
      </div>
    </form>
    <CredentialsModal
      v-if="isCredentialsOpen"
      :message="errorGuidance('auth_required') ?? ''"
      @close="cancelCredentials"
      @submit="retryWithCredentials"
    />
    <CertTrustDialog
      v-if="certPrompt"
      :prompt="certPrompt"
      :is-busy="isTrusting"
      @cancel="cancelCertPrompt"
      @trust="followCertStep(trustCert())"
      @import-authority="followCertStep(importAuthority())"
    />
  </BaseModal>
</template>

<style scoped>
.repo-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.repo-form p {
  margin: 0;
}

.repo-form__check {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-block-size: var(--size-touch-target-min);
}

.repo-form__check .field__hint {
  display: block;
}

.repo-form__cert-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.repo-form__test {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-sm);
}

.repo-form__test-status {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  align-self: stretch;
}

.repo-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
