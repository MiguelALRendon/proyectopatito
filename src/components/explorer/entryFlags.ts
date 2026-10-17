import type { FileEntry } from '../../services/filesApi';
import { changeBadges, type StateBadge } from '../../utils/svnBadges';
import type { IconName } from '../../utils/iconPaths';

export interface EntryFlag {
  icon: IconName;
  label: string;
}

const FOLDER_PREFIX = 'Carpeta';
const FILE_PREFIX = 'Archivo';

const FLAG_RULES: readonly [(entry: FileEntry) => boolean, EntryFlag][] = [
  [(entry) => entry.cloud_only, { icon: 'cloud', label: 'Solo en la nube' }],
  [
    (entry) => entry.escapes_workspace,
    {
      icon: 'warning',
      label: 'Enlace fuera del área de trabajo, no se puede abrir',
    },
  ],
  [
    (entry) => entry.is_link && !entry.escapes_workspace,
    { icon: 'link', label: 'Enlace' },
  ],
  [(entry) => entry.read_only, { icon: 'lock', label: 'Solo lectura' }],
];

export function entryFlags(entry: FileEntry): EntryFlag[] {
  return FLAG_RULES.filter(([applies]) => applies(entry)).map(
    ([, flag]) => flag,
  );
}

export function entryAriaLabel(
  entry: FileEntry,
  badges: readonly StateBadge[] = [],
): string {
  const prefix = entry.kind === 'dir' ? FOLDER_PREFIX : FILE_PREFIX;
  const notes = entryFlags(entry).map((flag) => flag.label.toLowerCase());
  const states = changeBadges(badges).map((badge) => badge.label);
  return [`${prefix}: ${entry.name}`, ...notes, ...states].join(', ');
}
