<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseModal from './BaseModal.vue';
import type { Credentials } from '../services/tauri';

defineProps<{ message: string }>();

const emit = defineEmits<{
  close: [];
  submit: [credentials: Credentials];
}>();

const username = ref('');
const password = ref('');
const wasSubmitted = ref(false);

const usernameError = computed(() =>
  username.value.trim() ? null : 'Indica el usuario.',
);
const passwordError = computed(() =>
  password.value ? null : 'Indica la contraseña.',
);

function submit() {
  wasSubmitted.value = true;
  if (usernameError.value || passwordError.value) {
    const firstInvalid = usernameError.value
      ? 'credentials-username'
      : 'credentials-password';
    document.getElementById(firstInvalid)?.focus();
    return;
  }
  emit('submit', {
    username: username.value.trim() || null,
    password: password.value || null,
  });
  password.value = '';
}
</script>

<template>
  <BaseModal
    title-id="credentials-title"
    description-id="credentials-message"
    :close-on-backdrop="false"
    @close="emit('close')"
  >
    <template #title>
      <h2 id="credentials-title">Credenciales requeridas</h2>
    </template>
    <p id="credentials-message" class="credentials__message">{{ message }}</p>
    <form class="credentials" novalidate @submit.prevent="submit">
      <div class="field">
        <label class="field__label" for="credentials-username">Usuario</label>
        <input
          id="credentials-username"
          v-model="username"
          class="field__input"
          type="text"
          autocomplete="username"
          :aria-invalid="wasSubmitted && usernameError !== null"
          aria-describedby="credentials-username-error"
        />
        <span id="credentials-username-error" class="field__error" role="alert">
          {{ wasSubmitted ? usernameError : '' }}
        </span>
      </div>
      <div class="field">
        <label class="field__label" for="credentials-password"
          >Contraseña</label
        >
        <input
          id="credentials-password"
          v-model="password"
          class="field__input"
          type="password"
          autocomplete="current-password"
          :aria-invalid="wasSubmitted && passwordError !== null"
          aria-describedby="credentials-password-error credentials-password-hint"
        />
        <span id="credentials-password-error" class="field__error" role="alert">
          {{ wasSubmitted ? passwordError : '' }}
        </span>
        <span id="credentials-password-hint" class="field__hint">
          La contraseña no se guarda: se usa solo para este intento.
        </span>
      </div>
      <div class="credentials__actions">
        <button type="button" class="btn" @click="emit('close')">
          Cancelar
        </button>
        <button type="submit" class="btn btn--primary">Reintentar</button>
      </div>
    </form>
  </BaseModal>
</template>

<style scoped>
.credentials__message {
  margin: 0;
}

.credentials {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.credentials__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
