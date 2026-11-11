import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  NO_CREDENTIALS,
  normalizeError,
  opCancel,
  runOperation,
  svnCheckout,
  wcCleanup,
  wcCommit,
  wcInfo,
  wcNeedsCleanup,
  wcStatus,
  wcUpdate,
  type CommandError,
  type Credentials,
  type InfoEntry,
  type OperationResult,
  type StatusReport,
} from '../services/tauri';
import { formatProgressLine } from '../utils/svnLabels';
import { useExplorerStore } from './explorer';

export const MAX_PROGRESS_LINES = 100;

export type OperationKind = 'checkout' | 'update' | 'commit' | 'cleanup';

export interface ActiveOperation {
  kind: OperationKind;
  id: number | null;
}

interface WorkingCopySnapshot {
  path: string | null;
  info: InfoEntry | null;
  status: StatusReport | null;
  cleanupTarget: string | null;
}

type StartOperation = (credentials: Credentials) => Promise<number>;

export const useProjectStore = defineStore('project', () => {
  const explorer = useExplorerStore();
  const path = ref<string | null>(null);
  const info = ref<InfoEntry | null>(null);
  const status = ref<StatusReport | null>(null);
  const operation = ref<ActiveOperation | null>(null);
  const progressLines = ref<string[]>([]);
  const error = ref<CommandError | null>(null);
  const wasCancelled = ref(false);
  const finishedOperations = ref(0);
  const cleanupTarget = ref<string | null>(null);
  const commitDraft = ref('');
  let retry: ((credentials: Credentials) => Promise<void>) | null = null;
  let latestRead = 0;

  const isReading = ref(false);
  const isBusy = computed(() => operation.value !== null);
  const isLocked = computed(() => isBusy.value || isReading.value);
  const canCleanup = computed(() => cleanupTarget.value !== null);

  function pushProgress(line: string) {
    progressLines.value = [...progressLines.value, line].slice(
      -MAX_PROGRESS_LINES,
    );
  }

  function resetFeedback() {
    error.value = null;
    wasCancelled.value = false;
    cleanupTarget.value = null;
    progressLines.value = [];
  }

  type FailedResult = Exclude<OperationResult, { status: 'ok' }>;

  async function cleanupTargetFor(
    result: FailedResult,
    target: string,
  ): Promise<string | null> {
    if (result.kind === 'working_copy_locked') return target;
    const isMarked = await wcNeedsCleanup(target).catch(() => false);
    return isMarked ? target : null;
  }

  async function applyResult(
    result: OperationResult,
    target: string,
  ): Promise<boolean> {
    if (result.status === 'ok') return true;
    if (result.kind === 'cancelled') wasCancelled.value = true;
    else error.value = result;
    cleanupTarget.value = await cleanupTargetFor(result, target);
    return false;
  }

  async function execute(
    kind: OperationKind,
    target: string,
    start: () => Promise<number>,
  ): Promise<boolean> {
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
      return await applyResult(result, target);
    } catch (raw) {
      error.value = normalizeError(raw);
      return false;
    } finally {
      operation.value = null;
    }
  }

  interface Submission {
    kind: OperationKind;
    target: string;
    start: StartOperation;
    credentials: Credentials;
    afterOk?: () => Promise<void>;
  }

  async function submit(submission: Submission): Promise<void> {
    if (isLocked.value) return;
    const { kind, target, start, credentials, afterOk = refresh } = submission;
    const reusable = { ...submission, credentials: NO_CREDENTIALS };
    retry = (next) => submit({ ...reusable, credentials: next });
    const isOk = await execute(kind, target, () => start(credentials));
    if (isOk) {
      retry = null;
      await whileReading(afterOk);
    }
    await explorer.reloadAfterChange();
    finishedOperations.value += 1;
  }

  async function refresh(): Promise<void> {
    const target = path.value;
    if (!target) return;
    const ticket = ++latestRead;
    try {
      const [freshInfo, freshStatus] = await Promise.all([
        wcInfo(target),
        wcStatus(target),
      ]);
      if (ticket !== latestRead) return;
      [info.value, status.value] = [freshInfo, freshStatus];
    } catch (raw) {
      if (ticket !== latestRead) return;
      info.value = null;
      status.value = null;
      error.value = normalizeError(raw);
      if (error.value.kind === 'working_copy_locked') {
        cleanupTarget.value = target;
      }
    }
  }

  async function whileReading(task: () => Promise<void>): Promise<void> {
    isReading.value = true;
    try {
      await task();
    } finally {
      isReading.value = false;
    }
  }

  function restoreSnapshot(snapshot: WorkingCopySnapshot) {
    path.value = snapshot.path;
    info.value = snapshot.info;
    status.value = snapshot.status;
    cleanupTarget.value = snapshot.cleanupTarget;
  }

  async function open(workingCopyPath: string): Promise<void> {
    if (isLocked.value) return;
    await whileReading(() => switchTo(workingCopyPath));
  }

  async function switchTo(workingCopyPath: string): Promise<void> {
    const previous = {
      path: path.value,
      info: info.value,
      status: status.value,
      cleanupTarget: cleanupTarget.value,
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
      target: dest,
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
    await submit({ kind: 'update', target, start, credentials });
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
      target,
      start,
      credentials: { username, password: null },
      afterOk: () => {
        commitDraft.value = '';
        return refresh();
      },
    });
  }

  async function cleanup(explicitTarget?: string): Promise<void> {
    const target = explicitTarget ?? cleanupTarget.value ?? path.value;
    if (!target) return;
    const start: StartOperation = () => wcCleanup({ path: target });
    await submit({
      kind: 'cleanup',
      target,
      start,
      credentials: NO_CREDENTIALS,
    });
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
    finishedOperations,
    commitDraft,
    isBusy,
    isLocked,
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
