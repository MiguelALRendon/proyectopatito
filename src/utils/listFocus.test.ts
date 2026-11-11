import { describe, expect, it } from 'vitest';
import { FAVORITE_FOCUS } from '../components/explorer/favoriteKeys';
import { TAB_FOCUS } from '../components/shell/tabKeys';
import { focusTarget } from './listFocus';

describe('focusTarget en pestañas (circular)', () => {
  it('goes to the edges with Home and End', () => {
    expect(focusTarget('Home', 2, 4, TAB_FOCUS)).toBe(0);
    expect(focusTarget('End', 1, 4, TAB_FOCUS)).toBe(3);
  });

  it('wraps around with the arrows', () => {
    expect(focusTarget('ArrowRight', 3, 4, TAB_FOCUS)).toBe(0);
    expect(focusTarget('ArrowLeft', 0, 4, TAB_FOCUS)).toBe(3);
    expect(focusTarget('ArrowRight', 1, 4, TAB_FOCUS)).toBe(2);
    expect(focusTarget('ArrowLeft', 2, 4, TAB_FOCUS)).toBe(1);
  });

  it('ignores other keys', () => {
    expect(focusTarget('x', 0, 4, TAB_FOCUS)).toBeNull();
  });
});

describe('focusTarget en favoritos (con tope)', () => {
  it('moves one favorite at a time and stops at the edges', () => {
    expect(focusTarget('ArrowDown', 1, 4, FAVORITE_FOCUS)).toBe(2);
    expect(focusTarget('ArrowUp', 1, 4, FAVORITE_FOCUS)).toBe(0);
    expect(focusTarget('ArrowDown', 3, 4, FAVORITE_FOCUS)).toBe(3);
    expect(focusTarget('ArrowUp', 0, 4, FAVORITE_FOCUS)).toBe(0);
  });

  it('jumps to the edges', () => {
    expect(focusTarget('Home', 2, 4, FAVORITE_FOCUS)).toBe(0);
    expect(focusTarget('End', 1, 4, FAVORITE_FOCUS)).toBe(3);
  });

  it('ignores other keys', () => {
    expect(focusTarget('ArrowLeft', 1, 4, FAVORITE_FOCUS)).toBeNull();
    expect(focusTarget('a', 1, 4, FAVORITE_FOCUS)).toBeNull();
  });
});
