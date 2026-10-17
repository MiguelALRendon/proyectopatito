<script setup lang="ts">
import { computed } from 'vue';
import type { WcHeaderState } from '../../stores/explorer';
import { branchLabel } from '../../utils/folderPaths';
import AppIcon from '../icons/AppIcon.vue';

const NO_VALUE = '-';
const UNREADABLE_NOTE = 'No se pudo leer la copia: revisa el panel inferior.';

const props = defineProps<{ header: WcHeaderState | null }>();

const facts = computed(() => {
  const info = props.header?.info;
  if (!info) return [];
  return [
    ['Repositorio', info.repository_root ?? info.url ?? NO_VALUE],
    ['Revisión', String(info.revision)],
    ['Raíz', info.working_copy_root ?? props.header?.root ?? NO_VALUE],
    ['Rama', branchLabel(info.relative_url) ?? NO_VALUE],
  ] as const;
});
</script>

<template>
  <section
    class="wc-header"
    :class="{ 'wc-header--local': header === null }"
    aria-label="Estado de la carpeta"
  >
    <template v-if="header === null">
      <h2 class="wc-header__title">
        <AppIcon name="folder" class="wc-header__icon" />
        Carpeta local
      </h2>
      <p class="wc-header__note">
        Esta carpeta no está bajo el control de Subversion.
      </p>
    </template>
    <template v-else>
      <h2 class="wc-header__title">
        <AppIcon name="link" class="wc-header__icon" />
        Working Copy
      </h2>
      <p v-if="header.error" class="wc-header__note" role="status">
        {{ UNREADABLE_NOTE }}
      </p>
      <dl v-else-if="header.info" class="wc-header__facts">
        <div v-for="[term, value] in facts" :key="term" class="wc-header__fact">
          <dt>{{ term }}</dt>
          <dd>{{ value }}</dd>
        </div>
      </dl>
      <p v-else class="wc-header__note" role="status">
        Leyendo la copia de trabajo…
      </p>
    </template>
  </section>
</template>

<style scoped>
.wc-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm) var(--space-lg);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-xl);
  background-color: var(--color-bg-elevated);
  box-shadow: var(--shadow-clay);
}

.wc-header__title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-size-base);
}

.wc-header__icon {
  color: var(--color-primary);
}

.wc-header__note {
  margin: 0;
  color: var(--color-text-muted);
}

.wc-header__facts {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: var(--space-xs) var(--space-lg);
  min-inline-size: 0;
  margin: 0;
}

.wc-header__fact {
  display: flex;
  gap: var(--space-xs);
  min-inline-size: 0;
}

.wc-header__fact dt {
  color: var(--color-text-muted);
}

.wc-header__fact dd {
  margin: 0;
  font-weight: var(--font-weight-bold);
  overflow-wrap: anywhere;
}
</style>
