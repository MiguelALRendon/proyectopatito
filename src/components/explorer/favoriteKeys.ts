const KEY_UP = 'ArrowUp';
const KEY_DOWN = 'ArrowDown';
const KEY_HOME = 'Home';
const KEY_END = 'End';

export const KEY_DELETE = 'Delete';
export const KEY_RENAME = 'F2';
export const MOVE_STEPS = new Map([
  [KEY_UP, -1],
  [KEY_DOWN, 1],
]);

export function favoriteFocusTarget(
  key: string,
  index: number,
  count: number,
): number | null {
  const last = count - 1;
  if (key === KEY_HOME) return 0;
  if (key === KEY_END) return last;
  if (key === KEY_DOWN) return Math.min(index + 1, last);
  if (key === KEY_UP) return Math.max(index - 1, 0);
  return null;
}
