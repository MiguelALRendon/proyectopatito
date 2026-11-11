import { clamp } from './clamp';

const KEY_HOME = 'Home';
const KEY_END = 'End';

export interface FocusMovement {
  steps: ReadonlyMap<string, number>;
  isCircular: boolean;
}

export function focusTarget(
  key: string,
  index: number,
  count: number,
  movement: FocusMovement,
): number | null {
  const last = count - 1;
  if (key === KEY_HOME) return 0;
  if (key === KEY_END) return last;
  const step = movement.steps.get(key);
  if (step === undefined) return null;
  if (movement.isCircular) return (index + step + count) % count;
  return clamp(index + step, 0, last);
}
