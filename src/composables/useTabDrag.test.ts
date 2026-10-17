import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  dropEdgeAt,
  dropIndexAt,
  useTabDrag,
  type Span,
} from './useTabDrag';

const SPANS: Span[] = [
  { start: 0, end: 100 },
  { start: 100, end: 200 },
  { start: 200, end: 300 },
];

describe('dropIndexAt', () => {
  it('drops at the start when the pointer is left of every other tab', () => {
    expect(dropIndexAt(SPANS, 2, -50)).toBe(0);
  });

  it('drops at the end when the pointer is right of every other tab', () => {
    expect(dropIndexAt(SPANS, 0, 999)).toBe(2);
  });

  it('does not count the dragged tab itself', () => {
    expect(dropIndexAt(SPANS, 1, 150)).toBe(1);
  });

  it('keeps the slot exactly on a midpoint (strictly past it is required)', () => {
    expect(dropIndexAt(SPANS, 0, 150)).toBe(0);
    expect(dropIndexAt(SPANS, 0, 151)).toBe(1);
  });

  it('is zero for a single tab', () => {
    expect(dropIndexAt([SPANS[0]], 0, 500)).toBe(0);
  });
});

describe('dropEdgeAt', () => {
  it('marks nothing when the tab stays in place or the row has no target', () => {
    expect(dropEdgeAt(1, 1, 1)).toBeNull();
    expect(dropEdgeAt(0, 1, 2)).toBeNull();
  });

  it('marks the leading edge when moving left and the trailing edge when moving right', () => {
    expect(dropEdgeAt(0, 2, 0)).toBe('before');
    expect(dropEdgeAt(2, 0, 2)).toBe('after');
  });
});

function pointer(
  clientX: number,
  button = 0,
  target: Partial<HTMLElement> = {},
  clientY = 0,
): PointerEvent {
  return {
    clientX,
    clientY,
    button,
    pointerId: 1,
    currentTarget: target,
  } as unknown as PointerEvent;
}

const onMove = vi.fn();

function drag() {
  return useTabDrag({
    spans: () => SPANS,
    indexOf: (id) => Number(id),
    onMove,
  });
}

beforeEach(() => onMove.mockReset());

describe('useTabDrag on the vertical axis', () => {
  function verticalDrag() {
    return useTabDrag({
      axis: 'y',
      spans: () => SPANS,
      indexOf: (id) => Number(id),
      onMove,
    });
  }

  it('follows the vertical pointer and ignores horizontal movement', () => {
    const listDrag = verticalDrag();
    listDrag.start(pointer(500, 0, {}, 50), '0');
    listDrag.move(pointer(0, 0, {}, 260));
    expect(listDrag.offset.value).toBe(210);
    expect(listDrag.dropIndex.value).toBe(2);
    listDrag.end();
    expect(onMove).toHaveBeenCalledWith('0', 2);
  });

  it('does not start from a purely horizontal movement', () => {
    const listDrag = verticalDrag();
    listDrag.start(pointer(50, 0, {}, 50), '0');
    listDrag.move(pointer(900, 0, {}, 50));
    expect(listDrag.draggingId.value).toBeNull();
  });
});

describe('useTabDrag', () => {
  it('ignores non-primary buttons', () => {
    const tabDrag = drag();
    tabDrag.start(pointer(50, 1), '0');
    tabDrag.move(pointer(250));
    tabDrag.end();
    expect(onMove).not.toHaveBeenCalled();
    expect(tabDrag.draggingId.value).toBeNull();
  });

  it('does not start before the movement threshold, so a click stays a click', () => {
    const tabDrag = drag();
    tabDrag.start(pointer(50), '0');
    tabDrag.move(pointer(50 + DRAG_THRESHOLD_PX - 1));
    expect(tabDrag.draggingId.value).toBeNull();
    tabDrag.end();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('ignores pointer moves that were not preceded by a pointer down', () => {
    const tabDrag = drag();
    tabDrag.move(pointer(500));
    tabDrag.end();
    expect(tabDrag.draggingId.value).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('works when the element cannot capture the pointer', () => {
    const tabDrag = drag();
    expect(() => tabDrag.start(pointer(50), '0')).not.toThrow();
  });

  it('captures the pointer on the element that received it', () => {
    const setPointerCapture = vi.fn();
    drag().start(pointer(50, 0, { setPointerCapture }), '0');
    expect(setPointerCapture).toHaveBeenCalledWith(1);
  });

  it('cancelling discards the drag without moving anything', () => {
    const tabDrag = drag();
    tabDrag.start(pointer(50), '0');
    tabDrag.move(pointer(260));
    expect(tabDrag.draggingId.value).toBe('0');
    tabDrag.cancel();
    tabDrag.end();
    expect(tabDrag.draggingId.value).toBeNull();
    expect(tabDrag.offset.value).toBe(0);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('dragging back to the original slot does not move the tab', () => {
    const tabDrag = drag();
    tabDrag.start(pointer(50), '0');
    tabDrag.move(pointer(260));
    tabDrag.move(pointer(40));
    tabDrag.end();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('a second drag does not inherit the previous one', () => {
    const tabDrag = drag();
    tabDrag.start(pointer(50), '0');
    tabDrag.move(pointer(260));
    tabDrag.end();
    onMove.mockClear();
    tabDrag.start(pointer(250), '2');
    tabDrag.move(pointer(252));
    tabDrag.end();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('tracks the offset and the target slot, then reports the move on release', () => {
    const tabDrag = drag();
    tabDrag.start(pointer(50), '0');
    tabDrag.move(pointer(260));
    expect(tabDrag.offset.value).toBe(210);
    expect(tabDrag.dropIndex.value).toBe(2);
    tabDrag.end();
    expect(onMove).toHaveBeenCalledWith('0', 2);
    expect(tabDrag.draggingId.value).toBeNull();
  });
});
