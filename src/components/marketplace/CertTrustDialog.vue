<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { CertPrompt } from '../../services/marketplaceApi';
import { TRUST_FAILURE_LABELS, formatFingerprint } from '../../utils/certLabels';
import { formatDate } from '../../utils/svnLabels';
import BaseModal from '../BaseModal.vue';

const SCOPE_NOTICE =
  'Confiar solo afecta a este servidor y a este certificado; si el servidor presenta otro distinto se te volverá a preguntar.';
const BUSY_NOTICE = 'Procesando…';

const props = defineProps<{ prompt: CertPrompt; isBusy: boolean }>();
const emit = defineEmits<{
  cancel: [];
  trust: [];
  importAuthority: [];
}>();

const cancelButton = ref<HTMLButtonElement | null>(null);

const server = computed(() => `${props.prompt.info.host}:${props.prompt.info.port}`);
const fingerprint = computed(() => formatFingerprint(props.prompt.info.sha256));
const validity = computed(
  () =>
    `${formatDate(props.prompt.info.not_before)} – ${formatDate(props.prompt.info.not_after)}`,
);
const reasons = computed(() =>
  props.prompt.reasons.map((reason) => TRUST_FAILURE_LABELS[reason]),
);
const suggestsAuthority = computed(
  () =>
    props.prompt.info.issuer !== props.prompt.info.subject &&
    props.prompt.reasons.includes('unknown-ca'),
);

onMounted(() => cancelButton.value?.focus());
</script>

<template>
  <BaseModal
    title-id="cert-trust-title"
    description-id="cert-trust-reasons"
    :close-on-backdrop="false"
    @close="emit('cancel')"
  >
    <template #title>
      <h2 id="cert-trust-title">Certificado no confiable</h2>
    </template>
    <dl class="cert-trust__details">
      <dt>Servidor</dt>
      <dd>{{ server }}</dd>
      <dt>Emisor</dt>
      <dd>{{ prompt.info.issuer }}</dd>
      <dt>Sujeto</dt>
      <dd>{{ prompt.info.subject }}</dd>
      <dt>Vigencia</dt>
      <dd>{{ validity }}</dd>
      <dt>Huella SHA-256</dt>
      <dd><code class="cert-trust__fingerprint">{{ fingerprint }}</code></dd>
    </dl>
    <div class="banner banner--warning">
      <h3 class="cert-trust__heading">Motivos</h3>
      <ul id="cert-trust-reasons" class="cert-trust__reasons">
        <li v-for="reason in reasons" :key="reason">{{ reason }}</li>
      </ul>
    </div>
    <div v-if="suggestsAuthority" class="cert-trust__authority">
      <p>
        Está firmado por «{{ prompt.info.issuer }}». Si tu empresa te dio el
        certificado de esa autoridad, es mejor importarlo.
      </p>
      <button
        type="button"
        class="btn"
        :disabled="isBusy"
        @click="emit('importAuthority')"
      >
        Importar autoridad…
      </button>
    </div>
    <p class="field__hint">{{ SCOPE_NOTICE }}</p>
    <div class="cert-trust__actions">
      <span class="cert-trust__status" role="status" aria-live="polite">{{
        isBusy ? BUSY_NOTICE : ''
      }}</span>
      <button
        ref="cancelButton"
        type="button"
        class="btn btn--primary"
        @click="emit('cancel')"
      >
        Cancelar
      </button>
      <button
        type="button"
        class="btn btn--danger"
        :disabled="isBusy"
        @click="emit('trust')"
      >
        Confiar en este certificado
      </button>
    </div>
  </BaseModal>
</template>

<style scoped>
.cert-trust__details {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-xs) var(--space-md);
  margin: 0;
}

.cert-trust__details dt {
  font-weight: var(--font-weight-bold);
}

.cert-trust__details dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.cert-trust__fingerprint {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  user-select: all;
}

.cert-trust__heading {
  margin: 0;
  font-size: var(--font-size-base);
}

.cert-trust__reasons {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin: 0;
  padding-inline-start: var(--space-md);
}

.cert-trust__authority {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-sm);
}

.cert-trust__authority p {
  margin: 0;
}

.cert-trust__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-sm);
}

.cert-trust__status {
  flex: 1;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
