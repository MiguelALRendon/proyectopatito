<script setup lang="ts">
import { READ_ONLY_NOTICE, describeSaveError } from '../../documents/labels';
import type { CommandError } from '../../services/tauri';

defineProps<{ isReadOnly: boolean; error: CommandError | null }>();
const emit = defineEmits<{ retry: []; reload: [] }>();
</script>

<template>
  <div
    v-if="isReadOnly"
    class="banner banner--warning editor-notices"
    role="alert"
  >
    <span>{{ READ_ONLY_NOTICE }}</span>
    <div class="editor-notices__actions">
      <button type="button" class="btn" @click="emit('retry')">
        Reintentar guardado
      </button>
      <button type="button" class="btn" @click="emit('reload')">
        Recargar
      </button>
    </div>
  </div>
  <div
    v-else-if="error"
    class="banner banner--error editor-notices"
    role="alert"
  >
    <span>{{ describeSaveError(error) }}</span>
    <button type="button" class="btn" @click="emit('retry')">Reintentar</button>
  </div>
</template>

<style scoped>
.editor-notices {
  flex: none;
  border-radius: 0;
}

.editor-notices__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
</style>
