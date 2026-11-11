import { call, onEvent } from './tauri';

export const ARCHIVE_PROGRESS_EVENT = 'archive://progress';

export type ArchiveFormat =
  'zip' | 'tar' | 'tar_gz' | 'tar_bz2' | 'tar_xz' | 'seven_z' | 'rar';

export type ArchiveEntryKind = 'file' | 'directory' | 'link' | 'device';

export type Suspicion = 'declared_size' | 'ratio' | 'depth';

export interface ArchiveEntry {
  name: string;
  kind: ArchiveEntryKind;
  size: number;
  packed: number | null;
  encrypted: boolean;
  skip_reason: string | null;
}

export interface ArchiveListing {
  format: ArchiveFormat;
  entries: ArchiveEntry[];
  entry_count: number;
  truncated: boolean;
  declared_bytes: number;
  largest_entry_bytes: number;
  encrypted: boolean;
  suspicions: Suspicion[];
}

export interface SkippedEntry {
  name: string;
  reason: string;
}

export interface ExtractReport {
  destination: string;
  files: number;
  directories: number;
  bytes: number;
  skipped: SkippedEntry[];
  skipped_more: number;
}

export interface ExtractProgress {
  id: number;
  files: number;
  bytes: number;
  total_bytes: number;
}

let lastTaskId = 0;

export const newArchiveTaskId = (): number => {
  lastTaskId += 1;
  return lastTaskId;
};

export const archiveList = (path: string, taskId: number) =>
  call<ArchiveListing>('archive_list', { path, task_id: taskId });

export const archiveExtract = (
  path: string,
  taskId: number,
  allowSuspicious = false,
) =>
  call<ExtractReport>('archive_extract', {
    path,
    task_id: taskId,
    allow_suspicious: allowSuspicious,
  });

export const archiveCancel = (taskId: number) =>
  call<boolean>('archive_cancel', { task_id: taskId });

export const onArchiveProgress = (
  handler: (progress: ExtractProgress) => void,
): Promise<() => void> =>
  onEvent<ExtractProgress>(ARCHIVE_PROGRESS_EVENT, handler);
