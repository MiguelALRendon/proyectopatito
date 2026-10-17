<script setup lang="ts">
type Orientation = 'vertical' | 'horizontal';

const props = withDefaults(
  defineProps<{
    label: string;
    value: number;
    min: number;
    max?: number;
    orientation?: Orientation;
  }>(),
  { max: undefined, orientation: 'vertical' },
);

const emit = defineEmits<{
  drag: [event: PointerEvent];
  nudge: [delta: number];
  jump: [target: number];
}>();

const KEYBOARD_STEP = 16;
const HOME_KEY = 'Home';
const END_KEY = 'End';
const FORWARD_KEY: Record<Orientation, string> = {
  vertical: 'ArrowRight',
  horizontal: 'ArrowDown',
};
const BACKWARD_KEY: Record<Orientation, string> = {
  vertical: 'ArrowLeft',
  horizontal: 'ArrowUp',
};

function keySign(key: string): -1 | 0 | 1 {
  if (key === FORWARD_KEY[props.orientation]) return 1;
  if (key === BACKWARD_KEY[props.orientation]) return -1;
  return 0;
}

function edgeTarget(key: string): number | undefined {
  if (key === HOME_KEY) return props.min;
  if (key === END_KEY) return props.max;
  return undefined;
}

function handleKeydown(event: KeyboardEvent) {
  const target = edgeTarget(event.key);
  if (target !== undefined) {
    event.preventDefault();
    emit('jump', target);
    return;
  }
  const sign = keySign(event.key);
  if (sign === 0) return;
  event.preventDefault();
  emit('nudge', sign * KEYBOARD_STEP);
}
</script>

<template>
  <div
    class="resize-handle"
    :class="`resize-handle--${orientation}`"
    role="separator"
    :aria-orientation="orientation"
    :aria-label="label"
    :aria-valuenow="value"
    :aria-valuemin="min"
    :aria-valuemax="max"
    tabindex="0"
    @pointerdown="emit('drag', $event)"
    @keydown="handleKeydown"
  ></div>
</template>

<style scoped>
.resize-handle {
  position: relative;
  z-index: var(--z-index-shell);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
}

.resize-handle--vertical {
  inline-size: var(--space-sm);
  cursor: col-resize;
}

.resize-handle--horizontal {
  block-size: var(--space-sm);
  cursor: row-resize;
}

.resize-handle::after {
  content: '';
  background-color: var(--color-border);
}

.resize-handle--vertical::after {
  inline-size: var(--border-width-sm);
  block-size: 100%;
}

.resize-handle--horizontal::after {
  block-size: var(--border-width-sm);
  inline-size: 100%;
}

.resize-handle:hover::after,
.resize-handle:active::after,
.resize-handle:focus-visible::after {
  background-color: var(--color-primary);
}
</style>
