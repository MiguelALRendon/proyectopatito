import { clamp } from '../utils/clamp';
import { BYTES_PER_ROW, HEX_CHUNK } from './limits';

export const ROW_HEIGHT_PX = 20;
export const MAX_SCROLL_HEIGHT_PX = 16_000_000;
export const EXTRA_ROWS = 2;
export const OFFSET_DIGITS = 8;
export const UNLOADED_BYTE = '··';
export const UNLOADED_CHAR = ' ';
export const UNPRINTABLE_CHAR = '.';

const HEX_RADIX = 16;
export const BYTE_DIGITS = 2;
const FIRST_PRINTABLE = 0x20;
const LAST_PRINTABLE = 0x7e;

export interface ScrollWindow {
  firstRow: number;
  rowCount: number;
}

export interface WindowInput {
  scrollTop: number;
  viewportHeight: number;
  totalRows: number;
}

export interface HexRow {
  index: number;
  offset: string;
  bytes: string[];
  ascii: string;
}

export type ByteReader = (offset: number) => number | undefined;

export const totalRowsOf = (length: number): number =>
  Math.ceil(Math.max(length, 0) / BYTES_PER_ROW);

export const spacerHeightOf = (totalRows: number): number =>
  Math.min(totalRows * ROW_HEIGHT_PX, MAX_SCROLL_HEIGHT_PX);

const visibleRowsOf = (viewportHeight: number): number =>
  Math.ceil(viewportHeight / ROW_HEIGHT_PX);

function firstRowOf(input: WindowInput): number {
  const lastFirstRow = Math.max(
    input.totalRows - visibleRowsOf(input.viewportHeight),
    0,
  );
  const travel = spacerHeightOf(input.totalRows) - input.viewportHeight;
  if (travel <= 0) return 0;
  return Math.round(clamp(input.scrollTop / travel, 0, 1) * lastFirstRow);
}

export function windowOf(input: WindowInput): ScrollWindow {
  const firstRow = firstRowOf(input);
  const wanted = visibleRowsOf(input.viewportHeight) + EXTRA_ROWS;
  return {
    firstRow,
    rowCount: Math.max(Math.min(wanted, input.totalRows - firstRow), 0),
  };
}

export function chunkIndexesOf(window: ScrollWindow): number[] {
  if (window.rowCount === 0) return [];
  const firstByte = window.firstRow * BYTES_PER_ROW;
  const lastByte = (window.firstRow + window.rowCount) * BYTES_PER_ROW - 1;
  const first = Math.floor(firstByte / HEX_CHUNK);
  const last = Math.floor(lastByte / HEX_CHUNK);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export const toHex = (value: number, digits: number): string =>
  value.toString(HEX_RADIX).toUpperCase().padStart(digits, '0');

export const formatOffset = (offset: number): string =>
  toHex(offset, OFFSET_DIGITS);

function asciiOf(value: number): string {
  const isPrintable = value >= FIRST_PRINTABLE && value <= LAST_PRINTABLE;
  return isPrintable ? String.fromCharCode(value) : UNPRINTABLE_CHAR;
}

export function buildRow(
  index: number,
  length: number,
  read: ByteReader,
): HexRow {
  const start = index * BYTES_PER_ROW;
  const count = Math.min(BYTES_PER_ROW, length - start);
  const values = Array.from({ length: count }, (_, i) => read(start + i));
  return {
    index,
    offset: formatOffset(start),
    bytes: values.map((v) =>
      v === undefined ? UNLOADED_BYTE : toHex(v, BYTE_DIGITS),
    ),
    ascii: values
      .map((v) => (v === undefined ? UNLOADED_CHAR : asciiOf(v)))
      .join(''),
  };
}
