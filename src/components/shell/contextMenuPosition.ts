export interface ContextMenuPositionInput {
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface ContextMenuPosition {
  x: number;
  y: number;
}

function clampAxis(point: number, size: number, viewport: number): number {
  const farthest = Math.max(0, viewport - size);
  const safePoint = Number.isFinite(point) ? point : 0;
  return Math.min(Math.max(safePoint, 0), farthest);
}

export function clampContextMenuPosition(
  input: ContextMenuPositionInput,
): ContextMenuPosition {
  return {
    x: clampAxis(input.x, input.menuWidth, input.viewportWidth),
    y: clampAxis(input.y, input.menuHeight, input.viewportHeight),
  };
}
