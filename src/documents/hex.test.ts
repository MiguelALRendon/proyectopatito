import { describe, expect, it } from 'vitest';
import {
  EXTRA_ROWS,
  MAX_SCROLL_HEIGHT_PX,
  ROW_HEIGHT_PX,
  UNLOADED_BYTE,
  buildRow,
  chunkIndexesOf,
  formatOffset,
  spacerHeightOf,
  totalRowsOf,
  windowOf,
} from './hex';
import { BYTES_PER_ROW, HEX_CHUNK } from './limits';

const VIEWPORT = 400;
const VISIBLE_ROWS = VIEWPORT / ROW_HEIGHT_PX;
const GIB = 1024 * 1024 * 1024;
const ROWS_PER_CHUNK = HEX_CHUNK / BYTES_PER_ROW;

describe('totalRowsOf y spacerHeightOf', () => {
  it('redondea hacia arriba y no acepta longitudes negativas', () => {
    expect(totalRowsOf(0)).toBe(0);
    expect(totalRowsOf(-5)).toBe(0);
    expect(totalRowsOf(1)).toBe(1);
    expect(totalRowsOf(BYTES_PER_ROW)).toBe(1);
    expect(totalRowsOf(BYTES_PER_ROW + 1)).toBe(2);
  });

  it('el alto del desplazamiento nunca supera el tope del navegador', () => {
    expect(spacerHeightOf(10)).toBe(10 * ROW_HEIGHT_PX);
    expect(spacerHeightOf(totalRowsOf(GIB))).toBe(MAX_SCROLL_HEIGHT_PX);
  });
});

describe('windowOf', () => {
  it('arriba del todo empieza en la fila 0', () => {
    const found = windowOf({
      scrollTop: 0,
      viewportHeight: VIEWPORT,
      totalRows: 1000,
    });
    expect(found).toEqual({ firstRow: 0, rowCount: VISIBLE_ROWS + EXTRA_ROWS });
  });

  it('en archivos pequeños una fila equivale a ROW_HEIGHT_PX de desplazamiento', () => {
    const found = windowOf({
      scrollTop: 5 * ROW_HEIGHT_PX,
      viewportHeight: VIEWPORT,
      totalRows: 1000,
    });
    expect(found.firstRow).toBe(5);
  });

  it('abajo del todo muestra la última fila y no sobrepasa el total', () => {
    const totalRows = 1000;
    const found = windowOf({
      scrollTop: spacerHeightOf(totalRows),
      viewportHeight: VIEWPORT,
      totalRows,
    });
    expect(found.firstRow + found.rowCount).toBe(totalRows);
    expect(found.firstRow).toBe(totalRows - VISIBLE_ROWS);
  });

  it('un archivo que cabe en pantalla muestra todas sus filas', () => {
    const found = windowOf({
      scrollTop: 9999,
      viewportHeight: VIEWPORT,
      totalRows: 3,
    });
    expect(found).toEqual({ firstRow: 0, rowCount: 3 });
  });

  it('un archivo vacío no tiene filas', () => {
    expect(
      windowOf({ scrollTop: 0, viewportHeight: VIEWPORT, totalRows: 0 }),
    ).toEqual({ firstRow: 0, rowCount: 0 });
  });

  it('un archivo de GiB escala el desplazamiento y llega a su última fila', () => {
    const totalRows = totalRowsOf(GIB);
    const bottom = windowOf({
      scrollTop: MAX_SCROLL_HEIGHT_PX,
      viewportHeight: VIEWPORT,
      totalRows,
    });
    expect(bottom.firstRow + bottom.rowCount).toBe(totalRows);
    const middle = windowOf({
      scrollTop: (MAX_SCROLL_HEIGHT_PX - VIEWPORT) / 2,
      viewportHeight: VIEWPORT,
      totalRows,
    });
    expect(middle.firstRow).toBeGreaterThan(totalRows / 2 - VISIBLE_ROWS);
    expect(middle.firstRow).toBeLessThan(totalRows / 2 + VISIBLE_ROWS);
    expect(middle.rowCount).toBe(VISIBLE_ROWS + EXTRA_ROWS);
  });

  it('un desplazamiento negativo o excesivo se acota', () => {
    const base = { viewportHeight: VIEWPORT, totalRows: 1000 };
    expect(windowOf({ ...base, scrollTop: -50 }).firstRow).toBe(0);
    expect(windowOf({ ...base, scrollTop: 1e12 }).firstRow).toBe(
      1000 - VISIBLE_ROWS,
    );
  });
});

describe('chunkIndexesOf', () => {
  it('sin filas no pide tramos', () => {
    expect(chunkIndexesOf({ firstRow: 0, rowCount: 0 })).toEqual([]);
  });

  it('una ventana dentro de un tramo pide solo ese', () => {
    expect(chunkIndexesOf({ firstRow: 0, rowCount: 10 })).toEqual([0]);
  });

  it('una ventana que cruza la frontera de 64 KiB pide dos tramos', () => {
    expect(
      chunkIndexesOf({ firstRow: ROWS_PER_CHUNK - 2, rowCount: 4 }),
    ).toEqual([0, 1]);
  });

  it('una ventana que termina justo en la frontera no pide el siguiente', () => {
    expect(
      chunkIndexesOf({ firstRow: ROWS_PER_CHUNK - 4, rowCount: 4 }),
    ).toEqual([0]);
  });
});

describe('formatOffset y buildRow', () => {
  it('el desplazamiento va en hexadecimal de 8 dígitos y mayúsculas', () => {
    expect(formatOffset(0)).toBe('00000000');
    expect(formatOffset(255)).toBe('000000FF');
    expect(formatOffset(0x1_0000_0000)).toBe('100000000');
  });

  it('marca como no cargados los bytes sin tramo', () => {
    const row = buildRow(0, 32, () => undefined);
    expect(row.bytes).toEqual(Array(BYTES_PER_ROW).fill(UNLOADED_BYTE));
    expect(row.ascii).toBe(' '.repeat(BYTES_PER_ROW));
  });

  it('la última fila es parcial', () => {
    const row = buildRow(1, 20, (offset) => offset);
    expect(row.bytes).toHaveLength(4);
    expect(row.offset).toBe('00000010');
  });

  it('los bytes no imprimibles son un punto y los imprimibles su carácter', () => {
    const data = [0x00, 0x1f, 0x20, 0x41, 0x7e, 0x7f, 0xff];
    const row = buildRow(0, data.length, (offset) => data[offset]);
    expect(row.bytes).toEqual(['00', '1F', '20', '41', '7E', '7F', 'FF']);
    expect(row.ascii).toBe('.. A~..');
  });
});
