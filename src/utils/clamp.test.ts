import { describe, expect, it } from 'vitest';
import { clamp } from './clamp';

describe('clamp', () => {
  it.each([
    [5, 0, 10, 5],
    [-3, 0, 10, 0],
    [42, 0, 10, 10],
    [0, 0, 10, 0],
    [10, 0, 10, 10],
  ])('clamp(%s, %s, %s) = %s', (value, min, max, expected) => {
    expect(clamp(value, min, max)).toBe(expected);
  });

  it('has no upper limit when max is omitted', () => {
    expect(clamp(1_000_000, 5)).toBe(1_000_000);
    expect(clamp(1, 5)).toBe(5);
  });

  it('prefers max when the limits are inverted', () => {
    expect(clamp(7, 10, 2)).toBe(2);
  });
});
