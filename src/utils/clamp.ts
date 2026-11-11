export function clamp(
  value: number,
  min: number,
  max: number = Number.POSITIVE_INFINITY,
): number {
  return Math.min(Math.max(value, min), max);
}
