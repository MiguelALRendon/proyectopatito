import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

export const PROGRESS_EVENT = 'svn://progress';
export const DONE_EVENT = 'svn://done';
export const CLOSE_REQUESTED_EVENT = 'app://close-requested';

export const ERROR_KINDS = [
  'no_workspace',
  'no_svn',
  'outside_workspace',
  'destination_exists',
  'invalid_path',
  'auth_required',
  'untrusted_certificate',
  'working_copy_too_old',
  'working_copy_locked',
  'cancelled',
  'timed_out',
  'svn_failed',
  'parse_failed',
  'io',
  'not_a_directory',
  'forbidden_path',
  'not_text',
  'too_large',
  'file_changed',
  'read_only',
  'file_locked',
  'working_copy_busy',
  'cloud_only',
  'not_allowed',
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export interface CommandError {
  kind: ErrorKind;
  message: string;
  codes: string[];
  detail: string | null;
}

export interface SvnBinary {
  path: string;
  version: string;
}

export interface SvnDetection {
  binary: SvnBinary | null;
  error: string | null;
}

export interface InfoEntry {
  path: string;
  kind: 'file' | 'dir' | 'none' | 'unknown';
  revision: number;
  url: string | null;
  relative_url: string | null;
  repository_root: string | null;
  repository_uuid: string | null;
  working_copy_root: string | null;
  last_changed_revision: number | null;
  last_changed_author: string | null;
  last_changed_date: string | null;
}

export interface StatusLock {
  owner: string;
  comment: string | null;
}

export interface StatusEntry {
  path: string;
  item: string;
  props: string;
  revision: number | null;
  remote_item: string | null;
  remote_props: string | null;
  wc_locked: boolean;
  tree_conflicted: boolean;
  copied: boolean;
  switched: boolean;
  lock: StatusLock | null;
}

export interface StatusReport {
  entries: StatusEntry[];
  against_revision: number | null;
}

export interface Credentials {
  username: string | null;
  password: string | null;
}

export const NO_CREDENTIALS: Readonly<Credentials> = Object.freeze({
  username: null,
  password: null,
});

export const CHECKOUT_DEPTHS = [
  'empty',
  'files',
  'immediates',
  'infinity',
] as const;

export type CheckoutDepth = (typeof CHECKOUT_DEPTHS)[number];

export interface CheckoutRequest extends Credentials {
  url: string;
  dest: string;
  revision: number | null;
  depth: CheckoutDepth;
  ignore_externals: boolean;
}

export interface UpdateRequest extends Credentials {
  path: string;
  revision: number | null;
  ignore_externals: boolean;
}

export interface CommitRequest extends Credentials {
  path: string;
  message: string;
}

export interface CleanupRequest {
  path: string;
}

export const ITEM_ACTIONS = [
  'added',
  'deleted',
  'updated',
  'conflicted',
  'merged',
  'existed',
  'replaced',
  'broken',
  'sending',
  'transmitting',
  'other',
] as const;

export type ItemAction = (typeof ITEM_ACTIONS)[number];

export type ProgressEvent =
  | { kind: 'item'; data: { action: ItemAction; path: string } }
  | { kind: 'revision'; data: { revision: number } }
  | { kind: 'other'; data: string };

export type OperationResult =
  | { status: 'ok'; revision: number | null }
  | ({ status: 'err' } & CommandError);

interface ProgressPayload {
  id: number;
  event: ProgressEvent;
}

interface DonePayload {
  id: number;
  result: OperationResult;
}

type TaggedEvent =
  | { id: number; progress: ProgressEvent }
  | { id: number; result: OperationResult };

const ERROR_KIND_SET: ReadonlySet<string> = new Set(ERROR_KINDS);

function isCommandErrorShape(raw: unknown): raw is Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) return false;
  const candidate = raw as Record<string, unknown>;
  return (
    typeof candidate.kind === 'string' &&
    ERROR_KIND_SET.has(candidate.kind) &&
    typeof candidate.message === 'string'
  );
}

export function normalizeError(raw: unknown): CommandError {
  if (isCommandErrorShape(raw)) {
    return {
      kind: raw.kind as ErrorKind,
      message: raw.message as string,
      codes: Array.isArray(raw.codes) ? (raw.codes as string[]) : [],
      detail: typeof raw.detail === 'string' ? raw.detail : null,
    };
  }
  const message = raw instanceof Error ? raw.message : String(raw);
  return { kind: 'io', message, codes: [], detail: null };
}

export async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export const workspaceGet = () => call<string | null>('workspace_get');
export const workspaceSet = (path: string) =>
  call<string>('workspace_set', { path });
export const svnDetect = () => call<SvnDetection>('svn_detect');
export const svnSetPath = (path: string) =>
  call<SvnDetection>('svn_set_path', { path });
export const wcInfo = (path: string) => call<InfoEntry>('wc_info', { path });
export const wcStatus = (path: string, remote = false) =>
  call<StatusReport>('wc_status', { path, remote });
export const opCancel = (id: number) => call<boolean>('op_cancel', { id });
export const wcNeedsCleanup = (path: string) =>
  call<boolean>('wc_needs_cleanup', { path });
export const svnCheckout = (req: CheckoutRequest) =>
  call<number>('svn_checkout', { req });
export const wcUpdate = (req: UpdateRequest) =>
  call<number>('wc_update', { req });
export const wcCommit = (req: CommitRequest) =>
  call<number>('wc_commit', { req });
export const wcCleanup = (req: CleanupRequest) =>
  call<number>('wc_cleanup', { req });

export const appFrontendReady = () => call<void>('app_frontend_ready');
export const appHoldClose = () => call<void>('app_hold_close');
export const appConfirmClose = () => call<void>('app_confirm_close');
export const appCancelClose = () => call<void>('app_cancel_close');

export const onCloseRequested = (handler: () => void): Promise<() => void> =>
  listen(CLOSE_REQUESTED_EVENT, handler);

export async function pickDirectory(): Promise<string | null> {
  try {
    return await open({ directory: true, multiple: false });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

class OperationSession {
  readonly result: Promise<OperationResult>;
  private operationId: number | null = null;
  private readonly early: TaggedEvent[] = [];
  private finish: (result: OperationResult) => void = () => undefined;

  constructor(private readonly onProgress: (event: ProgressEvent) => void) {
    this.result = new Promise<OperationResult>((resolve) => {
      this.finish = resolve;
    });
  }

  push(tagged: TaggedEvent) {
    if (this.operationId === null) this.early.push(tagged);
    else this.dispatch(tagged);
  }

  bind(id: number) {
    this.operationId = id;
    this.early.splice(0).forEach((tagged) => this.dispatch(tagged));
  }

  private dispatch(tagged: TaggedEvent) {
    if (tagged.id !== this.operationId) return;
    if ('progress' in tagged) this.onProgress(tagged.progress);
    else this.finish(tagged.result);
  }
}

export async function runOperation(
  start: () => Promise<number>,
  onProgress: (event: ProgressEvent) => void,
): Promise<OperationResult> {
  const session = new OperationSession(onProgress);
  const unlisteners = await Promise.all([
    listen<ProgressPayload>(PROGRESS_EVENT, ({ payload }) =>
      session.push({ id: payload.id, progress: payload.event }),
    ),
    listen<DonePayload>(DONE_EVENT, ({ payload }) =>
      session.push({ id: payload.id, result: payload.result }),
    ),
  ]);
  try {
    session.bind(await start());
    return await session.result;
  } catch (raw) {
    throw normalizeError(raw);
  } finally {
    unlisteners.forEach((unlisten) => unlisten());
  }
}
