import type { FocusMovement } from '../../utils/listFocus';

export const MIDDLE_BUTTON = 1;

const KEY_LEFT = 'ArrowLeft';
const KEY_RIGHT = 'ArrowRight';
const KEY_F10 = 'F10';

export const KEY_DELETE = 'Delete';
export const KEY_MENU = 'ContextMenu';
export const MOVE_STEPS = new Map([
  [KEY_LEFT, -1],
  [KEY_RIGHT, 1],
]);

export const TAB_FOCUS: FocusMovement = {
  steps: MOVE_STEPS,
  isCircular: true,
};

export function isMenuKey(event: KeyboardEvent): boolean {
  return event.key === KEY_MENU || (event.shiftKey && event.key === KEY_F10);
}
