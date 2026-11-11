import { ref } from 'vue';

export const DRAG_THRESHOLD_PX = 4;
export const PRIMARY_BUTTON = 0;

export type DragAxis = 'x' | 'y';

export interface Span {
  start: number;
  end: number;
}

export type DropEdge = 'before' | 'after' | null;

interface PendingDrag {
  id: string;
  from: number;
  origin: number;
}

export interface TabDragOptions {
  axis?: DragAxis;
  spans: () => Span[];
  indexOf: (id: string) => number;
  onMove: (id: string, to: number) => void;
}

export function dropIndexAt(
  spans: Span[],
  from: number,
  pointer: number,
): number {
  const others = spans.filter((_, index) => index !== from);
  const middle = (span: Span) => (span.start + span.end) / 2;
  return others.filter((span) => middle(span) < pointer).length;
}

export function dropEdgeAt(index: number, from: number, to: number): DropEdge {
  if (index !== to || from === to) return null;
  return to > from ? 'after' : 'before';
}

export function useTabDrag(options: TabDragOptions) {
  const axis = options.axis ?? 'x';
  const coordinate = (event: PointerEvent) =>
    axis === 'x' ? event.clientX : event.clientY;
  const draggingId = ref<string | null>(null);
  const offset = ref(0);
  const dropIndex = ref(0);
  let pending: PendingDrag | null = null;

  function reset() {
    pending = null;
    draggingId.value = null;
    offset.value = 0;
  }

  function start(event: PointerEvent, id: string) {
    if (event.button !== PRIMARY_BUTTON) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    pending = { id, from: options.indexOf(id), origin: coordinate(event) };
  }

  function move(event: PointerEvent) {
    if (!pending) return;
    const pointer = coordinate(event);
    const distance = pointer - pending.origin;
    const isStarted = draggingId.value !== null;
    if (!isStarted && Math.abs(distance) < DRAG_THRESHOLD_PX) return;
    draggingId.value = pending.id;
    offset.value = distance;
    dropIndex.value = dropIndexAt(options.spans(), pending.from, pointer);
  }

  function end() {
    const drag = pending;
    const target = dropIndex.value;
    const wasDragging = draggingId.value !== null;
    reset();
    if (drag && wasDragging && target !== drag.from) {
      options.onMove(drag.id, target);
    }
  }

  return { draggingId, offset, dropIndex, start, move, end, cancel: reset };
}
