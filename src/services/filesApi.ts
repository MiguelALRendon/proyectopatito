import { call, type Credentials, type StatusEntry } from './tauri';

export const WORKSPACE_FILE_ORIGIN = 'http://workspace-file.localhost';

const PATH_SEPARATORS = /[\\/]/;

export const PROBE_KINDS = [
  'text',
  'image',
  'pdf',
  'office',
  'audio',
  'video',
  'archive',
  'binary',
  'cloud',
] as const;

export type ProbeKind = (typeof PROBE_KINDS)[number];

export const TEXT_ENCODINGS = ['utf8', 'utf16_le', 'utf16_be'] as const;

export type TextEncoding = (typeof TEXT_ENCODINGS)[number];

export const LINE_ENDINGS = ['lf', 'crlf'] as const;

export type LineEnding = (typeof LINE_ENDINGS)[number];

export type EntryKind = 'file' | 'dir';

export interface FileEntry {
  name: string;
  kind: EntryKind;
  size: number;
  modified_ms: number | null;
  hidden: boolean;
  read_only: boolean;
  is_link: boolean;
  escapes_workspace: boolean;
  cloud_only: boolean;
}

export interface WcLocation {
  root: string;
  is_root: boolean;
}

export interface DirListing {
  path: string;
  entries: FileEntry[];
  truncated: boolean;
  wc: WcLocation | null;
}

export interface FileProbe {
  kind: ProbeKind;
  mime: string;
  len: number;
  extension: string | null;
  has_macros: boolean;
  version: string | null;
}

export interface TextDocument {
  content: string;
  encoding: TextEncoding;
  has_bom: boolean;
  eol: LineEnding;
  eol_mixed: boolean;
  version: string;
  len: number;
}

export interface WriteTextRequest {
  path: string;
  content: string;
  encoding: TextEncoding;
  has_bom: boolean;
  eol: LineEnding;
  expected_version: string;
}

export interface TextWritten {
  version: string;
}

export interface WcStatusMap {
  entries: StatusEntry[];
  changed_folders: string[];
  truncated: boolean;
  against_revision: number | null;
}

export interface StatusMapRequest extends Credentials {
  wc_root: string;
  remote: boolean;
  refresh: boolean;
}

export const VIEW_MODES = ['grid', 'list', 'details'] as const;

export type ViewMode = (typeof VIEW_MODES)[number];

export const VIEW_COLUMNS = ['type', 'size', 'modified', 'svn'] as const;

export type ViewColumn = (typeof VIEW_COLUMNS)[number];

export const SORT_KEYS = [
  'name',
  'type',
  'size',
  'modified',
  'status',
] as const;

export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const TAB_KINDS = ['folder', 'document'] as const;

export type TabKind = (typeof TAB_KINDS)[number];

export interface Favorite {
  path: string;
  name: string;
}

export interface Tab {
  id: string;
  kind: TabKind;
  path: string;
  title: string;
}

export interface FolderView {
  mode: ViewMode;
  columns: ViewColumn[];
  sort: SortKey;
  sort_direction: SortDirection;
  updated_ms: number;
}

export interface UiState {
  version: number;
  favorites: Favorite[];
  tabs: Tab[];
  active_tab: string | null;
  views: Record<string, FolderView>;
}

export type Located<T> = T & { exists: boolean };

export interface UiStateView {
  version: number;
  favorites: Located<Favorite>[];
  tabs: Located<Tab>[];
  active_tab: string | null;
  views: Record<string, Located<FolderView>>;
}

export const fsList = (path: string) => call<DirListing>('fs_list', { path });
export const fsProbe = (path: string, allowDownload = false) =>
  call<FileProbe>('fs_probe', { path, allow_download: allowDownload });
export const fsReadText = (path: string) =>
  call<TextDocument>('fs_read_text', { path });
export const fsWriteText = (req: WriteTextRequest) =>
  call<TextWritten>('fs_write_text', { req });
const OFFICE_PATH_HEADER = 'path';
const OFFICE_VERSION_HEADER = 'expected-version';

export const fsWriteBytes = (
  path: string,
  expectedVersion: string,
  bytes: Uint8Array,
) =>
  call<TextWritten>('fs_write_bytes', bytes, {
    headers: {
      [OFFICE_PATH_HEADER]: encodeURIComponent(path),
      [OFFICE_VERSION_HEADER]: expectedVersion,
    },
  });
export const fsReadChunk = (path: string, offset: number, len: number) =>
  call<ArrayBuffer>('fs_read_chunk', { path, offset, len });
export const fsCanOpenExternal = (path: string) =>
  call<boolean>('fs_can_open_external', { path });
export const fsOpenExternal = (path: string) =>
  call<void>('fs_open_external', { path });
export const wcStatusMap = (req: StatusMapRequest) =>
  call<WcStatusMap>('wc_status_map', { req });
export const uiStateGet = () => call<UiStateView>('ui_state_get');
export const uiStateSet = (req: UiState) =>
  call<UiStateView>('ui_state_set', { req });

export function fileUrl(relativePath: string): string {
  const segments = relativePath
    .split(PATH_SEPARATORS)
    .filter((segment) => segment !== '')
    .map(encodeURIComponent);
  return [WORKSPACE_FILE_ORIGIN, ...segments].join('/');
}
