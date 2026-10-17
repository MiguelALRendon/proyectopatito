export const MIDDLE_BUTTON = 1;

const KEY_HOME = 'Home';
const KEY_END = 'End';
const KEY_LEFT = 'ArrowLeft';
const KEY_RIGHT = 'ArrowRight';
const KEY_F10 = 'F10';

export const KEY_DELETE = 'Delete';
export const KEY_MENU = 'ContextMenu';
export const MOVE_STEPS = new Map([
  [KEY_LEFT, -1],
  [KEY_RIGHT, 1],
]);

export function focusTarget(
  key: string,
  index: number,
  count: number,
): number | null {
  const last = count - 1;
  if (key === KEY_HOME) return 0;
  if (key === KEY_END) return last;
  if (key === KEY_RIGHT) return index === last ? 0 : index + 1;
  if (key === KEY_LEFT) return index === 0 ? last : index - 1;
  return null;
}

export function isMenuKey(event: KeyboardEvent): boolean {
  return event.key === KEY_MENU || (event.shiftKey && event.key === KEY_F10);
}
