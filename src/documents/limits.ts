import type { FileProbe } from '../services/filesApi';

const BYTES_PER_KIB = 1024;

export const MAX_EDITABLE_MIB = 5;
export const MAX_EDITABLE_BYTES =
  MAX_EDITABLE_MIB * BYTES_PER_KIB * BYTES_PER_KIB;
export const HEX_CHUNK = 64 * BYTES_PER_KIB;
export const BYTES_PER_ROW = 16;

export function isTooLarge(probe: FileProbe): boolean {
  return probe.kind === 'text' && probe.len > MAX_EDITABLE_BYTES;
}

export const MAX_RESPONSE_MIB = 32;
export const MAX_RESPONSE_BYTES =
  MAX_RESPONSE_MIB * BYTES_PER_KIB * BYTES_PER_KIB;
export const PDF_RANGE_CHUNK_BYTES = 4 * BYTES_PER_KIB * BYTES_PER_KIB;
export const PDF_MAX_IMAGE_PIXELS = 4096 * 4096;

export const MAX_OFFICE_MIB = 32;
export const MAX_OFFICE_BYTES = MAX_OFFICE_MIB * BYTES_PER_KIB * BYTES_PER_KIB;
export const OFFICE_LOAD_TIMEOUT_MS = 60_000;
export const OFFICE_CLOSE_TIMEOUT_MS = 5_000;
export const OFFICE_SAVE_TIMEOUT_MS = 60_000;
export const SAVE_SETTLE_TIMEOUT_MS = 15_000;
export const OFFICE_RELEASED_BYTES =
  BYTES_PER_KIB * BYTES_PER_KIB * BYTES_PER_KIB;
export const OFFICE_RELEASE_TIMEOUT_MS = 30_000;
export const OFFICE_RELEASE_POLL_MS = 500;
