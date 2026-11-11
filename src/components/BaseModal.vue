<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useFocusTrap } from '../composables/useFocusTrap';
import { useModalIsolation } from '../composables/useModalIsolation';

const props = withDefaults(
  defineProps<{
    titleId: string;
    role?: 'dialog' | 'alertdialog';
    descriptionId?: string;
    closeOnBackdrop?: boolean;
  }>(),
  {
    role: 'dialog',
    descriptionId: undefined,
    closeOnBackdrop: true,
  },
);

const emit = defineEmits<{
  close: [];
}>();

const overlay = ref<HTMLElement | null>(null);
const modalScope = ref<HTMLElement | null>(null);
useModalIsolation(overlay);
useFocusTrap(modalScope);

function closeOnBackdropClick() {
  if (props.closeOnBackdrop) emit('close');
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => document.addEventListener('keydown', closeOnEscape));
onBeforeUnmount(() => document.removeEventListener('keydown', closeOnEscape));
</script>

<template>
  <Teleport to="body">
    <div
      ref="overlay"
      class="base-modal__overlay"
      @click.self="closeOnBackdropClick"
    >
      <div
        ref="modalScope"
        class="base-modal"
        :role="role"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
      >
        <slot name="title" />
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.base-modal__overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-index-modal);
  background-color: var(--color-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-md);
  overflow-y: auto;
}

.base-modal {
  background-color: var(--color-bg);
  border: none;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-clay);
  padding: var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-width: var(--size-modal-min-width);
  max-width: var(--size-content-max-width);
  width: 100%;
  max-height: var(--size-modal-max-height);
  overflow-y: auto;
}
</style>
