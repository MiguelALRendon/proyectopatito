<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectStore } from '../stores/project';
import BaseModal from './BaseModal.vue';

const emit = defineEmits<{
  close: [];
  submit: [payload: { message: string; username: string | null }];
}>();

const project = useProjectStore();
const username = ref('');
const wasSubmitted = ref(false);

const trimmedMessage = computed(() => project.commitDraft.trim());
const messageError = computed(() =>
  trimmedMessage.value ? null : 'Escribe el mensaje del commit.',
);

function submit() {
  wasSubmitted.value = true;
  if (messageError.value) {
    document.getElementById('commit-message')?.focus();
    return;
  }
  emit('submit', {
    message: project.commitDraft,
    username: username.value.trim() || null,
  });
}
</script>

<template>
  <BaseModal
    title-id="commit-title"
    :close-on-backdrop="false"
    @close="emit('close')"
  >
    <template #title>
      <h2 id="commit-title">Confirmar cambios</h2>
    </template>
    <form class="commit-form" novalidate @submit.prevent="submit">
      <div class="field">
        <label class="field__label" for="commit-message">Mensaje</label>
        <textarea
          id="commit-message"
          v-model="project.commitDraft"
          class="field__input"
          :aria-invalid="wasSubmitted && messageError !== null"
          aria-describedby="commit-message-error"
        />
        <span id="commit-message-error" class="field__error" role="alert">
          {{ wasSubmitted ? messageError : '' }}
        </span>
      </div>
      <div class="field">
        <label class="field__label" for="commit-username"
          >Usuario (opcional)</label
        >
        <input
          id="commit-username"
          v-model="username"
          class="field__input"
          type="text"
          autocomplete="username"
        />
      </div>
      <div class="commit-form__actions">
        <button type="button" class="btn" @click="emit('close')">
          Cancelar
        </button>
        <button type="submit" class="btn btn--primary">Confirmar</button>
      </div>
    </form>
  </BaseModal>
</template>

<style scoped>
.commit-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.commit-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
