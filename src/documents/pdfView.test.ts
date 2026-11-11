import { describe, expect, it } from 'vitest';
import {
  MAX_CANVAS_PIXELS,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  clampPage,
  clampZoom,
  fitWidthZoom,
  formatZoom,
  parsePageInput,
  safeRenderScale,
  stepZoom,
} from './pdfView';

describe('clampPage: adversarial', () => {
  it.each([
    [0, 5, 1],
    [-3, 5, 1],
    [6, 5, 5],
    [Number.NaN, 5, 1],
    [Number.POSITIVE_INFINITY, 5, 1],
    [2.9, 5, 2],
    [3, 0, 1],
  ])('clampPage(%s, %s) = %s', (page, total, expected) => {
    expect(clampPage(page, total)).toBe(expected);
  });

  it('una página válida se conserva', () => {
    expect(clampPage(3, 5)).toBe(3);
  });
});

describe('parsePageInput: adversarial', () => {
  it.each(['', '  ', 'abc', '1e2', '-1', '2.5', '0x2', '١٢'])(
    'rechaza %j',
    (text) => {
      expect(parsePageInput(text, 5)).toBeNull();
    },
  );

  it('recorta lo que se sale del rango', () => {
    expect(parsePageInput('999', 5)).toBe(5);
    expect(parsePageInput('0', 5)).toBe(1);
  });

  it('acepta espacios alrededor', () => {
    expect(parsePageInput(' 3 ', 5)).toBe(3);
  });
});

describe('zoom: adversarial', () => {
  it('stepZoom no sale del rango por ningún lado', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it('desde un valor entre pasos salta al paso siguiente o anterior', () => {
    expect(stepZoom(0.9, 1)).toBe(1);
    expect(stepZoom(0.9, -1)).toBe(0.75);
    expect(stepZoom(1.4, 1)).toBe(1.5);
    expect(stepZoom(1.4, -1)).toBe(1.25);
  });

  it('desde un valor fuera del rango vuelve al rango', () => {
    expect(stepZoom(10, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(0.01, -1)).toBe(MIN_ZOOM);
  });

  it('clampZoom corrige NaN e infinitos', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });

  it('fitWidthZoom ignora anchos inválidos', () => {
    expect(fitWidthZoom(0, 600)).toBe(1);
    expect(fitWidthZoom(-5, 600)).toBe(1);
    expect(fitWidthZoom(600, 0)).toBe(1);
    expect(fitWidthZoom(Number.NaN, 600)).toBe(1);
  });

  it('fitWidthZoom se queda dentro del rango', () => {
    expect(fitWidthZoom(60, 600)).toBe(MIN_ZOOM);
    expect(fitWidthZoom(60_000, 600)).toBe(MAX_ZOOM);
  });

  it('los pasos están ordenados y contienen el 100 %', () => {
    expect([...ZOOM_STEPS]).toEqual([...ZOOM_STEPS].sort((a, b) => a - b));
    expect(ZOOM_STEPS).toContain(1);
  });
});

describe('safeRenderScale: adversarial', () => {
  it('una página enorme baja la escala para no pasar del límite de píxeles', () => {
    const size = { width: 10_000, height: 10_000 };
    const scale = safeRenderScale(4, size);
    expect(size.width * size.height * scale * scale).toBeLessThanOrEqual(
      MAX_CANVAS_PIXELS * 1.0001,
    );
    expect(scale).toBeLessThan(4);
  });

  it('la escala resultante es scale * sqrt(MAX / píxeles) exacta', () => {
    expect(safeRenderScale(4, { width: 10_000, height: 10_000 })).toBeCloseTo(
      0.6,
      10,
    );
    expect(safeRenderScale(2, { width: 6000, height: 6000 })).toBeCloseTo(
      1,
      10,
    );
  });

  it('en el límite exacto de píxeles no se reduce', () => {
    expect(safeRenderScale(1, { width: 6000, height: 6000 })).toBe(1);
    expect(safeRenderScale(1, { width: 6000, height: 6001 })).toBeLessThan(1);
  });

  it('una página normal conserva su escala', () => {
    expect(safeRenderScale(2, { width: 612, height: 792 })).toBe(2);
  });
});

describe('formatZoom', () => {
  it('redondea a porcentaje entero con espacio antes del signo', () => {
    expect(formatZoom(1)).toBe('100 %');
    expect(formatZoom(0.755)).toBe('76 %');
    expect(formatZoom(1.5)).toBe('150 %');
  });
});
