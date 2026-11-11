<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue';
import { fsCanOpenExternal, fsOpenExternal } from '../../services/filesApi';
import { normalizeError } from '../../services/tauri';
import AppIcon from '../icons/AppIcon.vue';

const FAILED_PREFIX = 'No se pudo abrir con la aplicación predeterminada';

const props = defineProps<{ path: string }>();

const isAllowed = ref(false);
const isOpening = ref(false);
const failure = shallowRef<string | null>(null);
let generation = 0;

async function isOpenable(path: string): Promise<boolean> {
  try {
    return await fsCanOpenExternal(path);
  } catch {
    return false;
  }
}

async function checkAllowed() {
  const current = ++generation;
  isAllowed.value = false;
  failure.value = null;
  const allowed = await isOpenable(props.path);
  if (current === generation) isAllowed.value = allowed;
}

async function openExternal() {
  isOpening.value = true;
  failure.value = null;
  try {
    await fsOpenExternal(props.path);
  } catch (error) {
    failure.value = `${FAILED_PREFIX}: ${normalizeError(error).message}`;
  } finally {
    isOpening.value = false;
  }
}

watch(() => props.path, checkAllowed, { immediate: true });
</script>

<template>
  <button
    v-if="isAllowed"
    type="button"
    class="btn open-external"
    :disabled="isOpening"
    :aria-busy="isOpening"
    @click="openExternal"
  >
    <AppIcon name="external" />
    Abrir con la aplicación predeterminada
  </button>
  <p
    v-if="failure"
    class="banner banner--error open-external__error"
    role="alert"
  >
    {{ failure }}
  </p>
</template>

<style scoped>
.open-external {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
}

.open-external__error {
  flex-basis: 100%;
  margin: 0;
}
</style>
