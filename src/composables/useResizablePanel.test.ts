import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import {
  LAYOUT_STORAGE_PREFIX,
  useResizablePanel,
  type ResizablePanelConfig,
} from './useResizablePanel';

const KEY = 'test';
const STORAGE_KEY = `${LAYOUT_STORAGE_PREFIX}${KEY}`;
const config: ResizablePanelConfig = { min: 100, max: 300, default: 200 };

function pointer(type: string, clientX: number, clientY = 0) {
  return new MouseEvent(type, {
    clientX,
    clientY,
    cancelable: true,
  }) as PointerEvent;
}

function move(clientX: number, clientY = 0) {
  window.dispatchEvent(pointer('pointermove', clientX, clientY));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('useResizablePanel storage', () => {
  it('uses the dakedaduck layout prefix', () => {
    const panel = useResizablePanel(KEY, config);
    panel.nudge(10);
    expect(localStorage.getItem('dakedaduck-layout-test')).toBe('210');
  });

  it.each(['abc', '', '   ', 'Infinity', 'NaN'])(
    'falls back to the default when the stored text is %j',
    (raw) => {
      localStorage.setItem(STORAGE_KEY, raw);
      expect(useResizablePanel(KEY, config).size.value).toBe(200);
    },
  );

  it.each([
    ['0', 100],
    ['-50', 100],
    ['99999', 300],
  ])('clamps the stored value %s into the limits', (raw, expected) => {
    localStorage.setItem(STORAGE_KEY, raw);
    expect(useResizablePanel(KEY, config).size.value).toBe(expected);
  });

  it('clamps a default that is outside the limits', () => {
    const panel = useResizablePanel(KEY, { ...config, default: 9999 });
    expect(panel.size.value).toBe(300);
  });

  it('survives a storage that throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(useResizablePanel(KEY, config).size.value).toBe(200);
  });

  it('keeps resizing in memory when the storage throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('lleno');
    });
    const panel = useResizablePanel(KEY, config);
    panel.nudge(30);
    expect(panel.size.value).toBe(230);
  });
});

describe('useResizablePanel limits', () => {
  it('never goes under the minimum', () => {
    const panel = useResizablePanel(KEY, config);
    panel.nudge(-9999);
    expect(panel.size.value).toBe(100);
  });

  it('never goes over the maximum', () => {
    const panel = useResizablePanel(KEY, config);
    panel.nudge(9999);
    expect(panel.size.value).toBe(300);
  });

  it('has no upper bound when max is omitted', () => {
    const panel = useResizablePanel(KEY, { min: 10, default: 20 });
    panel.nudge(5000);
    expect(panel.size.value).toBe(5020);
  });

  it.each([NaN, Infinity, -Infinity])(
    'ignores a %s delta and keeps the current size',
    (delta) => {
      const panel = useResizablePanel(KEY, config);
      panel.nudge(delta);
      expect(panel.size.value).toBe(200);
    },
  );
});

describe('useResizablePanel dragging', () => {
  it('prevents the default action of the pointer down', () => {
    const panel = useResizablePanel(KEY, config);
    const down = pointer('pointerdown', 0);
    panel.startDrag(down);
    expect(down.defaultPrevented).toBe(true);
    window.dispatchEvent(pointer('pointerup', 0));
  });

  it('follows the pointer and clamps while dragging', () => {
    const panel = useResizablePanel(KEY, config);
    panel.startDrag(pointer('pointerdown', 500));
    move(520);
    expect(panel.size.value).toBe(220);
    move(5000);
    expect(panel.size.value).toBe(300);
    move(-5000);
    expect(panel.size.value).toBe(100);
    window.dispatchEvent(pointer('pointerup', 0));
  });

  it('ignores a pointer event without coordinates', () => {
    const panel = useResizablePanel(KEY, config);
    panel.startDrag(pointer('pointerdown', 500));
    window.dispatchEvent(
      Object.assign(new Event('pointermove'), {
        clientX: undefined,
      }) as unknown as PointerEvent,
    );
    expect(panel.size.value).toBe(200);
    window.dispatchEvent(pointer('pointerup', 0));
  });

  it('stops following after pointer up', () => {
    const panel = useResizablePanel(KEY, config);
    panel.startDrag(pointer('pointerdown', 0));
    window.dispatchEvent(pointer('pointerup', 0));
    move(50);
    expect(panel.dragging.value).toBe(false);
    expect(panel.size.value).toBe(200);
  });

  it('stops following after pointer cancel', () => {
    const panel = useResizablePanel(KEY, config);
    panel.startDrag(pointer('pointerdown', 0));
    window.dispatchEvent(pointer('pointercancel', 0));
    move(50);
    expect(panel.size.value).toBe(200);
  });

  it('does not stack listeners when a drag starts twice', () => {
    const panel = useResizablePanel(KEY, config);
    panel.startDrag(pointer('pointerdown', 0));
    panel.startDrag(pointer('pointerdown', 100));
    move(130);
    expect(panel.size.value).toBe(230);
    window.dispatchEvent(pointer('pointerup', 0));
  });

  it('releases the listeners when its scope is disposed mid-drag', () => {
    const scope = effectScope();
    const panel = scope.run(() => useResizablePanel(KEY, config))!;
    panel.startDrag(pointer('pointerdown', 0));
    scope.stop();
    move(40);
    expect(panel.size.value).toBe(200);
    expect(panel.dragging.value).toBe(false);
  });

  it('measures the vertical axis and inverts with direction -1', () => {
    const panel = useResizablePanel(KEY, {
      ...config,
      axis: 'y',
      direction: -1,
    });
    panel.startDrag(pointer('pointerdown', 0, 400));
    move(999, 370);
    expect(panel.size.value).toBe(230);
    window.dispatchEvent(pointer('pointerup', 0));
  });
});

describe('useResizablePanel keyboard nudge', () => {
  it('applies the direction to the delta', () => {
    const panel = useResizablePanel(KEY, { ...config, direction: -1 });
    panel.nudge(16);
    expect(panel.size.value).toBe(184);
  });
});

describe('useResizablePanel jump', () => {
  it('sets the size to the value and clamps it, ignoring the direction', () => {
    const panel = useResizablePanel(KEY, { ...config, direction: -1 });
    panel.jumpTo(100);
    expect(panel.size.value).toBe(100);
    panel.jumpTo(9999);
    expect(panel.size.value).toBe(300);
  });
});

describe('useResizablePanel happy path', () => {
  it('restores the size stored by a previous session', () => {
    localStorage.setItem(STORAGE_KEY, '250');
    expect(useResizablePanel(KEY, config).size.value).toBe(250);
  });

  it('persists a drag so the next session restores it', () => {
    const first = useResizablePanel(KEY, config);
    first.startDrag(pointer('pointerdown', 0));
    move(60);
    window.dispatchEvent(pointer('pointerup', 0));
    expect(useResizablePanel(KEY, config).size.value).toBe(260);
  });
});
