import { describe, expect, it } from 'vitest';
import { focusTarget, isMenuKey } from './tabKeys';

describe('focusTarget', () => {
  it('goes to the edges with Home and End', () => {
    expect(focusTarget('Home', 2, 4)).toBe(0);
    expect(focusTarget('End', 1, 4)).toBe(3);
  });

  it('wraps around with the arrows', () => {
    expect(focusTarget('ArrowRight', 3, 4)).toBe(0);
    expect(focusTarget('ArrowLeft', 0, 4)).toBe(3);
    expect(focusTarget('ArrowRight', 1, 4)).toBe(2);
    expect(focusTarget('ArrowLeft', 2, 4)).toBe(1);
  });

  it('ignores other keys', () => {
    expect(focusTarget('x', 0, 4)).toBeNull();
  });
});

describe('isMenuKey', () => {
  it('accepts the context menu key and Shift+F10 only', () => {
    expect(
      isMenuKey(new KeyboardEvent('keydown', { key: 'ContextMenu' })),
    ).toBe(true);
    expect(
      isMenuKey(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true })),
    ).toBe(true);
    expect(isMenuKey(new KeyboardEvent('keydown', { key: 'F10' }))).toBe(false);
  });
});
