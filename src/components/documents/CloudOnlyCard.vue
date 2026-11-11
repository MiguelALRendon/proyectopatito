<script setup lang="ts">
import { computed } from 'vue';
import type { CommandError } from '../../services/tauri';
import { formatSize } from '../../utils/entryDisplay';
import { fileNameOf } from '../../utils/folderPaths';
import AppIcon from '../icons/AppIcon.vue';

const props = defineProps<{
  path: string;
  size: number;
  isDownloading: boolean;
  error: CommandError | null;
}>();

const emit = defineEmits<{ download: [] }>();

const fileName = computed(() => fileNameOf(props.path));
</script>

<template>
  <article class="cloud-card card" :aria-label="`Archivo ${fileName}`">
    <header class="cloud-card__header">
      <AppIcon name="cloud" class="cloud-card__icon" />
      <h2 class="cloud-card__title">{{ fileName }}</h2>
    </header>
    <p class="cloud-card__text">
      Este archivo está solo en la nube. Abrirlo no lo ha descargado y no se ha
      leído su contenido.
    </p>
    <p class="cloud-card__size">Tamaño: {{ formatSize(size) }}</p>
    <div v-if="error" class="banner banner--error" role="alert">
      <span>No se pudo descargar el archivo: {{ error.message }}</span>
    </div>
    <div class="cloud-card__actions">
      <button
        type="button"
        class="btn btn--primary"
        :disabled="isDownloading"
        :aria-busy="isDownloading"
        @click="emit('download')"
      >
        <AppIcon name="download" />
        {{ isDownloading ? 'Descargando…' : 'Descargar y abrir' }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.cloud-card {
  min-inline-size: 0;
}

.cloud-card__header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.cloud-card__icon {
  inline-size: var(--size-icon-card);
  block-size: var(--size-icon-card);
  color: var(--color-primary);
}

.cloud-card__title {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.cloud-card__text,
.cloud-card__size {
  margin: 0;
}

.cloud-card__size {
  color: var(--color-text-muted);
}

.cloud-card__actions .btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
}

.cloud-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
</style>
