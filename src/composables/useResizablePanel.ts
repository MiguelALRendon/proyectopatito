import { onScopeDispose, ref, type Ref } from 'vue';
import { usePersistedPreference } from './usePersistedPreference';

export const LAYOUT_STORAGE_PREFIX = 'dakedaduck-layout-';

export type PanelAxis = 'x' | 'y';
export type PanelDirection = 1 | -1;

export interface ResizablePanelConfig {
  min: number;
  max?: number;
  default: number;
  axis?: PanelAxis;
  direction?: PanelDirection;
}

export interface ResizablePanelHandle {
  size: Ref<number>;
  dragging: Ref<boolean>;
  min: number;
  max?: number;
  startDrag: (event: PointerEvent) => void;
  nudge: (delta: number) => void;
  jumpTo: (value: number) => void;
}

function clampBetween(value: number, min: number, max?: number): number {
  const lowered = Math.max(min, value);
  return max === undefined ? lowered : Math.min(max, lowered);
}

function parseStoredSize(
  raw: string,
  clamp: (value: number) => number,
): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clamp(parsed) : null;
}

function pointerPosition(event: PointerEvent, axis: PanelAxis): number {
  return axis === 'x' ? event.clientX : event.clientY;
}

function trackPointer(
  onMove: (event: PointerEvent) => void,
  onEnd: () => void,
): () => void {
  const stop = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    onEnd();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
  return stop;
}

function usePointerDrag(
  size: Ref<number>,
  setSize: (value: number) => void,
  config: Pick<ResizablePanelConfig, 'axis' | 'direction'>,
) {
  const axis = config.axis ?? 'x';
  const direction = config.direction ?? 1;
  const dragging = ref(false);
  let stopActiveDrag = () => {};

  function startDrag(event: PointerEvent) {
    event.preventDefault();
    stopActiveDrag();
    const origin = pointerPosition(event, axis);
    const startSize = size.value;
    dragging.value = true;
    stopActiveDrag = trackPointer(
      (move) =>
        setSize(startSize + (pointerPosition(move, axis) - origin) * direction),
      () => (dragging.value = false),
    );
  }

  onScopeDispose(() => stopActiveDrag(), true);
  return { dragging, startDrag };
}

export function useResizablePanel(
  key: string,
  config: ResizablePanelConfig,
): ResizablePanelHandle {
  const { min, max } = config;
  const direction = config.direction ?? 1;
  const clamp = (value: number) => clampBetween(value, min, max);
  const size = usePersistedPreference<number>(
    `${LAYOUT_STORAGE_PREFIX}${key}`,
    clamp(config.default),
    (raw) => parseStoredSize(raw, clamp),
  );

  function setSize(value: number) {
    if (Number.isFinite(value)) size.value = clamp(value);
  }

  const { dragging, startDrag } = usePointerDrag(size, setSize, config);

  return {
    size,
    dragging,
    min,
    max,
    startDrag,
    nudge: (delta) => setSize(size.value + delta * direction),
    jumpTo: setSize,
  };
}
