<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import { appAbout, normalizeError, type AppAbout } from '../services/tauri';
import { useWorkspaceStore } from '../stores/workspace';
import BaseModal from './BaseModal.vue';
import SvnWarning from './SvnWarning.vue';

const ORIGIN_LABELS = {
  bundled: 'incluido con la aplicación',
  configured: 'elegido por ti',
  system: 'instalado en el sistema',
} as const;

const emit = defineEmits<{ close: [] }>();

const workspace = useWorkspaceStore();
const about = shallowRef<AppAbout | null>(null);
const failure = shallowRef<string | null>(null);

onMounted(async () => {
  try {
    about.value = await appAbout();
  } catch (raw) {
    failure.value = normalizeError(raw).message;
  }
});
</script>

<template>
  <BaseModal title-id="about-title" @close="emit('close')">
    <template #title>
      <h2 id="about-title">Acerca de dakedaduck svn</h2>
    </template>
    <p v-if="failure" class="banner banner--error" role="alert">
      {{ failure }}
    </p>
    <dl class="about__facts">
      <dt>Versión de la aplicación</dt>
      <dd>{{ about?.version ?? '…' }}</dd>
      <dt>Subversion</dt>
      <dd v-if="workspace.svn?.binary">
        {{ workspace.svn.binary.version }}
        ({{ ORIGIN_LABELS[workspace.svn.binary.origin] }})
      </dd>
      <dd v-else>no detectado</dd>
    </dl>
    <SvnWarning />
    <section v-if="about" aria-labelledby="about-licenses-title">
      <h3 id="about-licenses-title">Licencias de terceros</h3>
      <pre
        class="about__licenses"
        tabindex="0"
        aria-label="Texto de las licencias de terceros"
        >{{ about.licenses }}</pre>
    </section>
    <div class="about__actions">
      <button type="button" class="btn btn--primary" @click="emit('close')">
        Cerrar
      </button>
    </div>
  </BaseModal>
</template>

<style scoped>
.about__facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-xs) var(--space-md);
  margin: 0;
}

.about__facts dt {
  color: var(--color-text-muted);
}

.about__facts dd {
  margin: 0;
}

.about__licenses {
  max-block-size: var(--size-licenses-max-height);
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
}

.about__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
