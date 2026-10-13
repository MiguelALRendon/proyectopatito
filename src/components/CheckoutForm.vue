<script setup lang="ts">
import { computed, ref } from 'vue';
import { isValidFolderName } from '../utils/svnLabels';

defineProps<{ isDisabled: boolean }>();

const emit = defineEmits<{
  submit: [payload: { url: string; name: string }];
}>();

const url = ref('');
const name = ref('');
const wasSubmitted = ref(false);

const trimmedUrl = computed(() => url.value.trim());
const trimmedName = computed(() => name.value.trim());
const urlError = computed(() =>
  trimmedUrl.value ? null : 'Indica la URL del repositorio.',
);
const nameError = computed(() =>
  isValidFolderName(trimmedName.value)
    ? null
    : 'Indica un nombre de carpeta sin separadores de ruta.',
);

function submit() {
  wasSubmitted.value = true;
  if (urlError.value || nameError.value) return;
  emit('submit', { url: trimmedUrl.value, name: trimmedName.value });
}
</script>

<template>
  <form class="checkout" novalidate @submit.prevent="submit">
    <div class="row">
      <div class="field">
        <label class="field__label" for="checkout-url"
          >URL del repositorio</label
        >
        <input
          id="checkout-url"
          v-model="url"
          class="field__input"
          type="text"
          autocomplete="off"
          :aria-invalid="wasSubmitted && urlError !== null"
          aria-describedby="checkout-url-error"
        />
      </div>
      <div class="field">
        <label class="field__label" for="checkout-name"
          >Carpeta en el workspace</label
        >
        <input
          id="checkout-name"
          v-model="name"
          class="field__input"
          type="text"
          autocomplete="off"
          :aria-invalid="wasSubmitted && nameError !== null"
          aria-describedby="checkout-name-error"
        />
      </div>
      <button type="submit" class="btn btn--primary" :disabled="isDisabled">
        Hacer checkout
      </button>
    </div>
    <span id="checkout-url-error" class="field__error" role="alert">
      {{ wasSubmitted ? urlError : '' }}
    </span>
    <span id="checkout-name-error" class="field__error" role="alert">
      {{ wasSubmitted ? nameError : '' }}
    </span>
  </form>
</template>

<style scoped>
.checkout {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
</style>
