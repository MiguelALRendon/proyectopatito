import type { SortKey, ViewColumn, ViewMode } from '../../services/filesApi';
import type { IconName } from '../../utils/iconPaths';

export const VIEW_MODE_OPTIONS: readonly {
  mode: ViewMode;
  label: string;
  icon: IconName;
}[] = [
  { mode: 'grid', label: 'Cuadrícula', icon: 'grid' },
  { mode: 'list', label: 'Lista', icon: 'list' },
  { mode: 'details', label: 'Detalles', icon: 'details' },
];

export const SORT_OPTIONS: readonly { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Nombre' },
  { key: 'type', label: 'Tipo' },
  { key: 'size', label: 'Tamaño' },
  { key: 'modified', label: 'Fecha' },
  { key: 'status', label: 'Estado SVN' },
];

export const COLUMN_OPTIONS: readonly { column: ViewColumn; label: string }[] =
  [
    { column: 'type', label: 'Tipo' },
    { column: 'size', label: 'Tamaño' },
    { column: 'modified', label: 'Modificado' },
    { column: 'svn', label: 'SVN' },
  ];

export const COLUMN_SORT_KEY: Partial<Record<ViewColumn, SortKey>> = {
  type: 'type',
  size: 'size',
  modified: 'modified',
  svn: 'status',
};

export const COLUMN_TRACK: Partial<Record<ViewColumn, string>> = {
  type: 'var(--size-column-medium)',
  size: 'var(--size-column-narrow)',
  modified: 'var(--size-column-medium)',
  svn: 'var(--size-column-wide)',
};

export const NAME_TRACK = 'minmax(0, 1fr)';
