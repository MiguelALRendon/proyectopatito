<script setup lang="ts">
import { computed } from 'vue';
import type { StatusOverlay } from '../../stores/explorer';
import type { ErrorKind } from '../../services/tauri';
import { errorGuidance } from '../../utils/svnLabels';

const LOADING_TEXT = 'Calculando el estado de Subversion…';
const CHECKING_TEXT = 'Comprobando el servidor…';
const FAILED_PREFIX = 'No se pudo calcular el estado de Subversion';
const TRUNCATED_TEXT =
  'Hay demasiados cambios: solo se muestran los distintivos de los primeros. Los demás elementos pueden aparecer como sin cambios.';

const props = defineProps<{
  status: StatusOverlay;
  headerErrorKind: ErrorKind | null;
}>();

const emit = defineEmits<{ askCredentials: [] }>();

const progressText = computed(() =>
  props.status.isCheckingServer ? CHECKING_TEXT : LOADING_TEXT,
);
const failure = computed(() => {
  const error = props.status.error;
  if (!error || props.status.isLoading) return null;
  const guidance = errorGuidance(error.kind);
  const isShownByHeader =
    guidance !== null && error.kind === props.headerErrorKind;
  return isShownByHeader
    ? null
    : `${FAILED_PREFIX}: ${guidance ?? error.message}`;
});
const serverText = computed(() => {
  const { isRemote, isLoading, error, againstRevision } = props.status;
  if (!isRemote || isLoading || error) return null;
  const suffix =
    againstRevision === null ? '' : ` (revisión ${againstRevision})`;
  return `Estado comparado con el servidor${suffix}.`;
});
const isTruncated = computed(
  () => props.status.truncated && !props.status.isLoading,
);
</script>

<template>
  <div class="status-notice">
    <p v-if="status.isLoading" class="status-notice__progress" role="status">
      <span class="status-notice__bar" aria-hidden="true"></span>
      {{ progressText }}
    </p>
    <div v-if="failure" class="banner banner--warning" role="status">
      <span>{{ failure }}</span>
      <button
        v-if="status.error?.kind === 'auth_required'"
        type="button"
        class="btn"
        @click="emit('askCredentials')"
      >
        Introducir credenciales
      </button>
    </div>
    <p v-if="isTruncated" class="banner banner--warning" role="status">
      {{ TRUNCATED_TEXT }}
    </p>
    <p v-if="serverText" class="status-notice__server" role="status">
      {{ serverText }}
    </p>
  </div>
</template>

<style scoped>
.status-notice {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.status-notice:empty {
  display: none;
}

.status-notice__progress,
.status-notice__server {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0;
  color: var(--color-text-muted);
}

.status-notice__bar {
  flex: none;
  inline-size: var(--space-lg);
  block-size: var(--space-xs);
  border-radius: var(--radius-sm);
  background-color: var(--color-primary);
  transform-origin: left center;
}

@media (prefers-reduced-motion: no-preference) {
  .status-notice__bar {
    animation: status-notice-pulse var(--duration-pop) var(--ease-standard)
      infinite alternate;
  }
}

@keyframes status-notice-pulse {
  from {
    opacity: var(--opacity-pop-from);
    transform: scaleX(var(--scale-pop-from));
  }
}
</style>
