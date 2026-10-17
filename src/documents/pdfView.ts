export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
export const MAX_CANVAS_PIXELS = 36_000_000;
const PERCENT = 100;
const FIRST_PAGE = 1;

export interface PageSize {
  width: number;
  height: number;
}

export function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page) || total < FIRST_PAGE) return FIRST_PAGE;
  return Math.min(Math.max(Math.trunc(page), FIRST_PAGE), total);
}

export function parsePageInput(text: string, total: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return clampPage(Number(trimmed), total);
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

export function stepZoom(current: number, direction: 1 | -1): number {
  const candidates =
    direction === 1
      ? ZOOM_STEPS.filter((step) => step > current)
      : ZOOM_STEPS.filter((step) => step < current).reverse();
  return candidates[0] ?? clampZoom(current);
}

export function fitWidthZoom(available: number, pageWidth: number): number {
  if (!(available > 0) || !(pageWidth > 0)) return 1;
  return clampZoom(available / pageWidth);
}

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * PERCENT)} %`;
}

export function safeRenderScale(scale: number, size: PageSize): number {
  const pixels = size.width * size.height * scale * scale;
  if (pixels <= MAX_CANVAS_PIXELS) return scale;
  return scale * Math.sqrt(MAX_CANVAS_PIXELS / pixels);
}
