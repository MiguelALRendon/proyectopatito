import { describe, expect, it } from 'vitest';
import { clampContextMenuPosition } from './contextMenuPosition';

const VIEWPORT = { viewportWidth: 1000, viewportHeight: 600 };
const MENU = { menuWidth: 200, menuHeight: 150 };

function clamp(x: number, y: number, size = MENU) {
  return clampContextMenuPosition({ x, y, ...size, ...VIEWPORT });
}

describe('clampContextMenuPosition', () => {
  it('pulls a menu that would overflow the right and bottom edges back inside', () => {
    expect(clamp(950, 580)).toEqual({ x: 800, y: 450 });
  });

  it('never goes negative', () => {
    expect(clamp(-30, -1)).toEqual({ x: 0, y: 0 });
  });

  it('pins a menu larger than the window to the origin', () => {
    expect(clamp(300, 300, { menuWidth: 2000, menuHeight: 900 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('treats non-finite coordinates as the origin instead of propagating NaN', () => {
    expect(clamp(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('keeps a menu that exactly touches the edge where it is', () => {
    expect(clamp(800, 450)).toEqual({ x: 800, y: 450 });
  });

  it('leaves a menu that already fits untouched', () => {
    expect(clamp(120, 80)).toEqual({ x: 120, y: 80 });
  });
});
