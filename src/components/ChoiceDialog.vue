<script setup lang="ts">
import { resolveChoice, useChoice } from '../composables/useChoice';
import BaseModal from './BaseModal.vue';

const TONE_CLASSES = {
  neutral: '',
  primary: 'btn--primary',
  danger: 'btn--danger',
} as const;

const { request } = useChoice();
</script>

<template>
  <BaseModal
    v-if="request"
    title-id="choice-dialog-title"
    role="alertdialog"
    description-id="choice-dialog-message"
    :close-on-backdrop="false"
    @close="resolveChoice(null)"
  >
    <template #title>
      <h2 id="choice-dialog-title">{{ request.title }}</h2>
    </template>
    <p id="choice-dialog-message" class="choice-dialog__message">
      {{ request.message }}
    </p>
    <div class="choice-dialog__actions">
      <button
        v-for="option in request.options"
        :key="option.value"
        type="button"
        class="btn"
        :class="TONE_CLASSES[option.tone ?? 'neutral']"
        @click="resolveChoice(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </BaseModal>
</template>

<style scoped>
.choice-dialog__message {
  margin: 0;
}

.choice-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
