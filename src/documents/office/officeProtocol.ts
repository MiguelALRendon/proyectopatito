export const OFFICE_FORMATS = [
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'doc',
  'xls',
  'ppt',
] as const;

export type OfficeFormat = (typeof OFFICE_FORMATS)[number];

export const OFFICE_KINDS = ['writer', 'calc', 'impress', 'unknown'] as const;

export type OfficeKind = (typeof OFFICE_KINDS)[number];

export const OFFICE_ERROR_CODES = [
  'boot-failed',
  'open-failed',
  'save-failed',
  'invalid-message',
  'busy',
] as const;

export type OfficeErrorCode = (typeof OFFICE_ERROR_CODES)[number];

export const OFFICE_INIT_TYPE = 'dakedaduck-office-init';

const MAX_TEXT_LENGTH = 400;

export type HostMessage =
  | { cmd: 'progress'; loaded: number; total: number }
  | { cmd: 'ready' }
  | { cmd: 'opened'; docId: string; kind: OfficeKind }
  | { cmd: 'closed'; docId: string }
  | { cmd: 'modified'; docId: string }
  | { cmd: 'save-requested'; docId: string }
  | { cmd: 'saved'; docId: string; requested: boolean; bytes: ArrayBuffer }
  | { cmd: 'blocked'; command: string }
  | { cmd: 'error'; code: OfficeErrorCode; detail: string; docId?: string };

export type PageMessage =
  | { cmd: 'open'; docId: string; ext: OfficeFormat; bytes: ArrayBuffer }
  | { cmd: 'save'; docId: string }
  | { cmd: 'close'; docId: string };

type Fields = Record<string, unknown>;

export function isOfficeFormat(value: unknown): value is OfficeFormat {
  return OFFICE_FORMATS.some((format) => format === value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isOneOf<T extends string>(
  options: readonly T[],
  value: unknown,
): value is T {
  return options.some((option) => option === value);
}

function withDocId(fields: Fields): fields is Fields & { docId: string } {
  return isText(fields.docId) && fields.docId.length > 0;
}

function parseProgress(fields: Fields): HostMessage | null {
  const { loaded, total } = fields;
  if (!isCount(loaded) || !isCount(total) || loaded > total) return null;
  return { cmd: 'progress', loaded, total };
}

function parseOpened(fields: Fields): HostMessage | null {
  if (!withDocId(fields) || !isOneOf(OFFICE_KINDS, fields.kind)) return null;
  return { cmd: 'opened', docId: fields.docId, kind: fields.kind };
}

function parseBlocked(fields: Fields): HostMessage | null {
  if (!isText(fields.command)) return null;
  return { cmd: 'blocked', command: fields.command };
}

function parseError(fields: Fields): HostMessage | null {
  const { code, detail, docId } = fields;
  if (!isOneOf(OFFICE_ERROR_CODES, code) || !isText(detail)) return null;
  if (docId === undefined) return { cmd: 'error', code, detail };
  if (!isText(docId)) return null;
  return { cmd: 'error', code, detail, docId };
}

function parseSaved(fields: Fields): HostMessage | null {
  const { bytes, requested } = fields;
  if (!withDocId(fields) || typeof requested !== 'boolean') return null;
  if (!(bytes instanceof ArrayBuffer)) return null;
  return { cmd: 'saved', docId: fields.docId, requested, bytes };
}

function parseDocEvent(
  cmd: 'closed' | 'modified' | 'save-requested',
  fields: Fields,
): HostMessage | null {
  return withDocId(fields) ? { cmd, docId: fields.docId } : null;
}

const PARSERS: Record<string, (fields: Fields) => HostMessage | null> = {
  progress: parseProgress,
  ready: () => ({ cmd: 'ready' }),
  opened: parseOpened,
  closed: (fields) => parseDocEvent('closed', fields),
  modified: (fields) => parseDocEvent('modified', fields),
  'save-requested': (fields) => parseDocEvent('save-requested', fields),
  saved: parseSaved,
  blocked: parseBlocked,
  error: parseError,
};

export function parseHostMessage(data: unknown): HostMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const fields = data as Fields;
  const cmd = fields.cmd;
  if (
    typeof cmd !== 'string' ||
    !Object.prototype.hasOwnProperty.call(PARSERS, cmd)
  )
    return null;
  return PARSERS[cmd](fields);
}
