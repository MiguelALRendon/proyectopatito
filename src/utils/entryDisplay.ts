import type { FileEntry } from '../services/filesApi';
import { extensionOf } from './entryOrder';
import { formatDate } from './svnLabels';

const BYTES_PER_STEP = 1024;
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const NO_VALUE = '-';
const FOLDER_LABEL = 'Carpeta';
const FILE_LABEL = 'Archivo';

const SIZE_FORMATTER = new Intl.NumberFormat('es', {
  maximumFractionDigits: 1,
});

export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= BYTES_PER_STEP && unit < SIZE_UNITS.length - 1) {
    value /= BYTES_PER_STEP;
    unit += 1;
  }
  return `${SIZE_FORMATTER.format(value)} ${SIZE_UNITS[unit]}`;
}

export function formatModified(milliseconds: number | null): string {
  if (milliseconds === null) return NO_VALUE;
  return formatDate(new Date(milliseconds).toISOString());
}

export function entryTypeLabel(entry: FileEntry): string {
  if (entry.kind === 'dir') return FOLDER_LABEL;
  const extension = extensionOf(entry.name);
  return extension ? `${FILE_LABEL} ${extension.toUpperCase()}` : FILE_LABEL;
}

export function entrySizeLabel(entry: FileEntry): string {
  return entry.kind === 'dir' ? NO_VALUE : formatSize(entry.size);
}
