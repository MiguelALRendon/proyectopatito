import type { ErrorKind, ProgressEvent, StatusEntry } from '../services/tauri';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

interface ItemLabel {
  label: string;
  tone: Tone;
}

const NO_STATE = 'none';
const NEUTRAL_ITEMS: ReadonlySet<string> = new Set([NO_STATE, 'normal']);
const BOOLEAN_FLAGS = [
  'tree_conflicted',
  'wc_locked',
  'copied',
  'switched',
] as const;

const ITEM_LABELS: Record<string, ItemLabel> = {
  none: { label: 'Sin estado', tone: 'neutral' },
  normal: { label: 'Sin cambios', tone: 'neutral' },
  unversioned: { label: 'Sin versionar', tone: 'warning' },
  added: { label: 'Agregado', tone: 'success' },
  modified: { label: 'Modificado', tone: 'warning' },
  deleted: { label: 'Eliminado', tone: 'danger' },
  missing: { label: 'Faltante', tone: 'danger' },
  replaced: { label: 'Reemplazado', tone: 'warning' },
  conflicted: { label: 'En conflicto', tone: 'danger' },
  tree_conflicted: { label: 'Conflicto de árbol', tone: 'danger' },
  ignored: { label: 'Ignorado', tone: 'neutral' },
  incomplete: { label: 'Incompleto', tone: 'danger' },
  external: { label: 'Externo', tone: 'neutral' },
  obstructed: { label: 'Tipo cambiado', tone: 'danger' },
  merged: { label: 'Fusionado', tone: 'success' },
  locked: { label: 'Bloqueado', tone: 'warning' },
  wc_locked: { label: 'Requiere limpieza', tone: 'danger' },
  copied: { label: 'Copiado', tone: 'neutral' },
  switched: { label: 'Cambiado de rama', tone: 'neutral' },
};

export const STATE_LEGEND: readonly (ItemLabel & { key: string })[] =
  Object.entries(ITEM_LABELS)
    .filter(([key]) => key !== NO_STATE)
    .map(([key, entry]) => ({ key, ...entry }));

const ACTION_LABELS: Record<string, string> = {
  added: 'Agregado',
  deleted: 'Eliminado',
  updated: 'Actualizado',
  conflicted: 'Conflicto',
  merged: 'Fusionado',
  existed: 'Ya existía',
  replaced: 'Reemplazado',
  broken: 'Roto',
  sending: 'Enviando',
  transmitting: 'Transmitiendo',
};

const ERROR_GUIDANCE: Partial<Record<ErrorKind, string>> = {
  untrusted_certificate:
    'El certificado del servidor no es de confianza. Acéptalo con otro cliente de Subversion y vuelve a intentarlo; esta aplicación nunca confía en certificados por su cuenta.',
  working_copy_too_old:
    'La copia de trabajo usa un formato antiguo. Ejecuta svn upgrade con otro cliente de Subversion; esta aplicación no lo hace por ti.',
  working_copy_locked:
    'La copia de trabajo está bloqueada por una operación interrumpida. Usa Cleanup para liberarla.',
  auth_required:
    'El servidor requiere credenciales. Introduce usuario y contraseña para reintentar.',
};

const FOLDER_NAME_PATTERN = /^[^\\/:*?"<>|]+$/;
const PARENT_SEGMENT = '..';
const CURRENT_SEGMENT = '.';

export function itemLabel(item: string): ItemLabel {
  return ITEM_LABELS[item] ?? { label: item, tone: 'neutral' };
}

export function entryStates(entry: StatusEntry): string[] {
  const states = [entry.item, entry.props].filter(
    (state) => !NEUTRAL_ITEMS.has(state),
  );
  states.push(...BOOLEAN_FLAGS.filter((flag) => entry[flag]));
  if (entry.lock) states.push('locked');
  return [...new Set(states)];
}

export function errorGuidance(kind: ErrorKind): string | null {
  return ERROR_GUIDANCE[kind] ?? null;
}

export function formatProgressLine(event: ProgressEvent): string {
  if (event.kind === 'revision') return `Revisión ${event.data.revision}`;
  if (event.kind === 'other') return event.data;
  const action = ACTION_LABELS[event.data.action] ?? event.data.action;
  return `${action} ${event.data.path}`;
}

export function isValidFolderName(name: string): boolean {
  const isSpecial = name === PARENT_SEGMENT || name === CURRENT_SEGMENT;
  return FOLDER_NAME_PATTERN.test(name) && !isSpecial;
}

const DATE_FORMATTER = new Intl.DateTimeFormat('es', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMATTER.format(date);
}
