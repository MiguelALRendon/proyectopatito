<script setup lang="ts">
import { computed } from 'vue';
import { useMarketplaceStore } from '../../stores/marketplace';

const NO_SELECTION_NOTICE = 'Selecciona un repositorio para explorarlo.';
const EMPTY_NOTICE =
  'Agrega tu primer repositorio con el botón «Agregar repositorio».';
const SELECTED_PREFIX = 'Repositorio seleccionado: ';
const NEXT_STEP_NOTICE =
  'El navegador de repositorios llega en el siguiente paso.';

const store = useMarketplaceStore();
const isEmpty = computed(() => store.repos.length === 0);
const statusText = computed(() => {
  if (store.selected) return `${SELECTED_PREFIX}${store.selected.name}`;
  return isEmpty.value ? EMPTY_NOTICE : NO_SELECTION_NOTICE;
});
</script>

<template>
  <section class="marketplace-home" aria-labelledby="marketplace-home-title">
    <h1 id="marketplace-home-title">Marketplace</h1>
    <p role="status">{{ statusText }}</p>
    <button
      v-if="isEmpty"
      type="button"
      class="btn btn--primary marketplace-home__add"
      @click="store.openForm(null)"
    >
      Agregar repositorio
    </button>
    <div v-if="store.selected" class="card">
      <h2>{{ store.selected.name }}</h2>
      <p class="marketplace-home__url">{{ store.selected.url }}</p>
      <p>{{ NEXT_STEP_NOTICE }}</p>
    </div>
  </section>
</template>

<style scoped>
.marketplace-home {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.marketplace-home p {
  margin: 0;
}

.marketplace-home__add {
  align-self: flex-start;
}

.marketplace-home__url {
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}
</style>
