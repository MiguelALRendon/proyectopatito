import type {
  ArchiveFormat,
  ExtractProgress,
  Suspicion,
} from '../services/archiveApi';

export const FORMAT_LABELS: Record<ArchiveFormat, string> = {
  zip: 'ZIP',
  tar: 'TAR',
  tar_gz: 'TAR comprimido con gzip',
  tar_bz2: 'TAR comprimido con bzip2',
  tar_xz: 'TAR comprimido con xz',
  seven_z: '7-Zip',
  rar: 'RAR',
};

export const SUSPICION_LABELS: Record<Suspicion, string> = {
  declared_size:
    'declara un tamaño total muy grande al descomprimirse (más de 1 GiB)',
  ratio: 'se comprime de forma desproporcionada (más de 200 veces)',
  depth: 'tiene carpetas anidadas a una profundidad inusual',
};

const ONEDRIVE_SEGMENT = /(^|[\\/])OneDrive( - [^\\/]+)?([\\/]|$)/i;
const HIDDEN_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;
const HEX_RADIX = 16;
const CODE_POINT_DIGITS = 4;
const FULL_PROGRESS = 1;

export function isOneDrivePath(path: string): boolean {
  return ONEDRIVE_SEGMENT.test(path);
}

function visibleCode(character: string): string {
  const code = (character.codePointAt(0) ?? 0).toString(HEX_RADIX);
  return `‹U+${code.toUpperCase().padStart(CODE_POINT_DIGITS, '0')}›`;
}

export function displayName(name: string): string {
  return name.replace(HIDDEN_CHARACTERS, visibleCode);
}

export function hasHiddenCharacters(name: string): boolean {
  return displayName(name) !== name;
}

export function suspicionReasons(codes: readonly string[]): string[] {
  return codes.map(
    (code) =>
      SUSPICION_LABELS[code as Suspicion] ??
      'tiene una característica fuera de lo habitual',
  );
}

export function progressFraction(progress: ExtractProgress | null): number {
  if (!progress || progress.total_bytes <= 0) return 0;
  return Math.min(FULL_PROGRESS, progress.bytes / progress.total_bytes);
}

export function countLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
