<script setup lang="ts">
import { useConfirm, resolveConfirm } from '../composables/useConfirm';
import BaseModal from './BaseModal.vue';

const { message, confirmLabel, title } = useConfirm();
</script>

<template>
  <BaseModal
    v-if="message"
    title-id="confirm-dialog-title"
    role="alertdialog"
    description-id="confirm-dialog-message"
    @close="resolveConfirm(false)"
  >
    <template #title>
      <h2 id="confirm-dialog-title">{{ title }}</h2>
    </template>
    <p id="confirm-dialog-message" class="confirm-dialog__message">
      {{ message }}
    </p>
    <div class="confirm-dialog__actions">
      <button type="button" class="btn" @click="resolveConfirm(false)">
        Volver
      </button>
      <button
        type="button"
        class="btn btn--danger"
        @click="resolveConfirm(true)"
      >
        {{ confirmLabel }}
      </button>
    </div>
  </BaseModal>
</template>

<style scoped>
.confirm-dialog__message {
  margin: 0;
}

.confirm-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
