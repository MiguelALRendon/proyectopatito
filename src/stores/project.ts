import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  normalizeError,
  opCancel,
  runOperation,
  svnCheckout,
  wcCleanup,
  wcCommit,
  wcInfo,
  wcStatus,
  wcUpdate,
  type CommandError,
  type Credentials,
  type InfoEntry,
  type OperationResult,
  type StatusReport,
} from '../services/tauri';
import { formatProgressLine } from '../utils/svnLabels';

export const MAX_PROGRESS_LINES = 100;

export const NO_CREDENTIALS: Credentials = { username: null, password: null };

export type OperationKind = 'checkout' | 'update' | 'commit' | 'cleanup';

export interface ActiveOperation {
  kind: OperationKind;
  id: number | null;
}

interface WorkingCopySnapshot {
  path: string | null;
  info: InfoEntry | null;
  status: StatusReport | null;
}

type StartOperation = (credentials: Credentials) => Promise<number>;

export const useProjectStore = defineStore('project', () => {
  const path = ref<string | null>(null);
  const info = ref<InfoEntry | null>(null);
  const status = ref<StatusReport | null>(null);
  const operation = ref<ActiveOperation | null>(null);
  const progressLines = ref<string[]>([]);
  const error = ref<CommandError | null>(null);
  const wasCancelled = ref(false);
  const commitDraft = ref('');
  let retry: ((credentials: Credentials) => Promise<void>) | null = null;

  const isBusy = computed(() => operation.value !== null);
  const canCleanup = computed(
    () => wasCancelled.value || error.value?.kind === 'working_copy_locked',
  );

  function pushProgress(line: string) {
    progressLines.value = [...progressLines.value, line].slice(
      -MAX_PROGRESS_LINES,
    );
  }

  function resetFeedback() {
    error.value = null;
    wasCancelled.value = false;
    progressLines.value = [];
  }

  function applyResult(result: OperationResult): boolean {
    if (result.status === 'ok') return true;
    if (result.kind === 'cancelled') wasCancelled.value = true;
    else error.value = result;
    return false;
  }

  async function execute(
    kind: OperationKind,
    start: () => Promise<number>,
  ): Promise<boolean> {
    if (operation.value) return false;
    resetFeedback();
    operation.value = { kind, id: null };
    const track = (id: number) => {
      operation.value = { kind, id };
      return id;
    };
    try {
      const result = await runOperation(
        () => start().then(track),
        (event) => pushProgress(formatProgressLine(event)),
      );
      return applyResult(result);
    } catch (raw) {
      error.value = normalizeError(raw);
      return false;
    } finally {
      operation.value = null;
    }
  }

  interface Submission {
    kind: OperationKind;
    start: StartOperation;
    credentials: Credentials;
    afterOk?: () => Promise<void>;
  }

  async function submit(submission: Submission): Promise<void> {
    const { kind, start, credentials, afterOk = refresh } = submission;
    retry = (next) => submit({ ...submission, credentials: next });
    const isOk = await execute(kind, () => start(credentials));
    if (isOk) await afterOk();
  }

  async function refresh(): Promise<void> {
    if (!path.value) return;
    try {
      [info.value, status.value] = await Promise.all([
        wcInfo(path.value),
        wcStatus(path.value),
      ]);
    } catch (raw) {
      info.value = null;
      status.value = null;
      error.value = normalizeError(raw);
    }
  }

  function restoreSnapshot(snapshot: WorkingCopySnapshot) {
    path.value = snapshot.path;
    info.value = snapshot.info;
    status.value = snapshot.status;
  }

  async function open(workingCopyPath: string): Promise<void> {
    const previous = {
      path: path.value,
      info: info.value,
      status: status.value,
    };
    resetFeedback();
    path.value = workingCopyPath;
    await refresh();
    if (error.value) return restoreSnapshot(previous);
    if (workingCopyPath !== previous.path) commitDraft.value = '';
  }

  async function checkout(
    url: string,
    dest: string,
    credentials: Credentials = NO_CREDENTIALS,
  ): Promise<void> {
    const start: StartOperation = (creds) =>
      svnCheckout({
        url,
        dest,
        revision: null,
        depth: 'infinity',
        ignore_externals: false,
        ...creds,
      });
    await submit({
      kind: 'checkout',
      start,
      credentials,
      afterOk: () => {
        path.value = dest;
        commitDraft.value = '';
        return refresh();
      },
    });
  }

  async function update(
    credentials: Credentials = NO_CREDENTIALS,
  ): Promise<void> {
    const target = path.value;
    if (!target) return;
    const start: StartOperation = (creds) =>
      wcUpdate({
        path: target,
        revision: null,
        ignore_externals: false,
        ...creds,
      });
    await submit({ kind: 'update', start, credentials });
  }

  async function commit(
    message: string,
    username: string | null,
  ): Promise<void> {
    const target = path.value;
    if (!target) return;
    const start: StartOperation = (creds) =>
      wcCommit({ path: target, message, ...creds });
    await submit({
      kind: 'commit',
      start,
      credentials: { username, password: null },
      afterOk: () => {
        commitDraft.value = '';
        return refresh();
      },
    });
  }

  async function cleanup(): Promise<void> {
    const target = path.value;
    if (!target) return;
    const start: StartOperation = () => wcCleanup({ path: target });
    await submit({ kind: 'cleanup', start, credentials: NO_CREDENTIALS });
  }

  async function retryWithCredentials(credentials: Credentials): Promise<void> {
    await retry?.(credentials);
  }

  async function cancel(): Promise<void> {
    const id = operation.value?.id;
    if (id == null) return;
    try {
      await opCancel(id);
    } catch (raw) {
      error.value = normalizeError(raw);
    }
  }

  return {
    path,
    info,
    status,
    operation,
    progressLines,
    error,
    wasCancelled,
    commitDraft,
    isBusy,
    canCleanup,
    open,
    refresh,
    checkout,
    update,
    commit,
    cleanup,
    cancel,
    retryWithCredentials,
  };
});
