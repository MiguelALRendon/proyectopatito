import type { FocusMovement } from '../../utils/listFocus';

const KEY_UP = 'ArrowUp';
const KEY_DOWN = 'ArrowDown';

export const KEY_DELETE = 'Delete';
export const KEY_RENAME = 'F2';
export const MOVE_STEPS = new Map([
  [KEY_UP, -1],
  [KEY_DOWN, 1],
]);

export const FAVORITE_FOCUS: FocusMovement = {
  steps: MOVE_STEPS,
  isCircular: false,
};
