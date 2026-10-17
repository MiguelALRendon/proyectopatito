import { describe, expect, it } from 'vitest';
import { favoriteFocusTarget } from './favoriteKeys';

describe('favoriteFocusTarget', () => {
  it('moves one favorite at a time and stops at the edges', () => {
    expect(favoriteFocusTarget('ArrowDown', 1, 4)).toBe(2);
    expect(favoriteFocusTarget('ArrowUp', 1, 4)).toBe(0);
    expect(favoriteFocusTarget('ArrowDown', 3, 4)).toBe(3);
    expect(favoriteFocusTarget('ArrowUp', 0, 4)).toBe(0);
  });

  it('jumps to the edges', () => {
    expect(favoriteFocusTarget('Home', 2, 4)).toBe(0);
    expect(favoriteFocusTarget('End', 1, 4)).toBe(3);
  });

  it('ignores other keys', () => {
    expect(favoriteFocusTarget('ArrowLeft', 1, 4)).toBeNull();
    expect(favoriteFocusTarget('a', 1, 4)).toBeNull();
  });
});
