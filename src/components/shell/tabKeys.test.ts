import { describe, expect, it } from 'vitest';
import { isMenuKey } from './tabKeys';

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
