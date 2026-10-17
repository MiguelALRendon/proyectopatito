import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';

vi.mock('../services/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/tauri')>()),
  wcInfo: vi.fn(),
  wcNeedsCleanup: vi.fn(),
  wcStatus: vi.fn(),
  runOperation: vi.fn(),
  opCancel: vi.fn(),
  svnCheckout: vi.fn(),
  wcUpdate: vi.fn(),
  wcCommit: vi.fn(),
  wcCleanup: vi.fn(),
}));

import * as service from '../services/tauri';
import type { OperationResult, ProgressEvent } from '../services/tauri';
import { useExplorerStore } from './explorer';
import { MAX_PROGRESS_LINES, useProjectStore } from './project';
import rawContract from '../../src-tauri/tests/fixtures/contract.json?raw';

const uiRequests = JSON.parse(rawContract).ui_requests;

const okResult: OperationResult = { status: 'ok', revision: 5 };
const errResult = (kind: string): OperationResult =>
  ({
    status: 'err',
    kind,
    message: `error ${kind}`,
    codes: [],
    detail: null,
  }) as OperationResult;

const info = { path: 'wc', kind: 'dir', revision: 5 } as service.InfoEntry;
const status = { entries: [], against_revision: null };

function fakeOperation(result: OperationResult, events: ProgressEvent[] = []) {
  vi.mocked(service.runOperation).mockImplementation(
    async (start, onProgress) => {
      await start();
      events.forEach(onProgress);
      return result;
    },
  );
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  vi.mocked(service.wcInfo).mockResolvedValue(info);
  vi.mocked(service.wcStatus).mockResolvedValue(status);
  vi.mocked(service.wcNeedsCleanup).mockResolvedValue(false);
  vi.mocked(service.wcUpdate).mockResolvedValue(11);
  vi.mocked(service.wcCommit).mockResolvedValue(12);
  vi.mocked(service.wcCleanup).mockResolvedValue(13);
  vi.mocked(service.svnCheckout).mockResolvedValue(14);
});

describe('open and refresh', () => {
  it('loads info and status of the opened working copy', async () => {
    const store = useProjectStore();
    await store.open('wc');
    expect(store.path).toBe('wc');
    expect(store.info).toEqual(info);
    expect(store.status).toEqual(status);
  });

  it('clears the data and shows the error when refresh fails', async () => {
    vi.mocked(service.wcInfo).mockRejectedValue({
      kind: 'working_copy_too_old',
      message: 'vieja',
    });
    const store = useProjectStore();
    await store.open('wc');
    expect(store.info).toBeNull();
    expect(store.status).toBeNull();
    expect(store.error?.kind).toBe('working_copy_too_old');
  });

  it('refresh does nothing without an open working copy', async () => {
    const store = useProjectStore();
    await store.refresh();
    expect(service.wcInfo).not.toHaveBeenCalled();
  });
});

describe('open failure and commit draft', () => {
  it('restores the previous working copy when opening another path fails', async () => {
    const store = useProjectStore();
    await store.open('wc');
    vi.mocked(service.wcInfo).mockRejectedValue({
      kind: 'invalid_path',
      message: 'no es copia',
    });
    await store.open('nope');
    expect(store.path).toBe('wc');
    expect(store.info).toEqual(info);
    expect(store.error?.kind).toBe('invalid_path');
  });

  it('keeps no active path when the very first open fails', async () => {
    vi.mocked(service.wcInfo).mockRejectedValue({
      kind: 'io',
      message: 'x',
    });
    const store = useProjectStore();
    await store.open('nope');
    expect(store.path).toBeNull();
    expect(store.info).toBeNull();
  });

  it('keeps the commit draft after a failed commit and clears it after a successful one', async () => {
    const store = useProjectStore();
    await store.open('wc');
    store.commitDraft = 'mensaje a medias';
    fakeOperation(errResult('svn_failed'));
    await store.commit('mensaje a medias', null);
    expect(store.commitDraft).toBe('mensaje a medias');
    fakeOperation(okResult);
    await store.commit('mensaje a medias', null);
    expect(store.commitDraft).toBe('');
  });

  it('drops the draft when another working copy is opened', async () => {
    const store = useProjectStore();
    await store.open('wc');
    store.commitDraft = 'borrador';
    await store.open('otra');
    expect(store.commitDraft).toBe('');
  });
});

describe('feedback reset', () => {
  const event: ProgressEvent = {
    kind: 'item',
    data: { action: 'added', path: 'a.txt' },
  };

  it('clears the cancellation notice when the next operation starts', async () => {
    fakeOperation(errResult('cancelled'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.wasCancelled).toBe(true);
    fakeOperation(okResult);
    await store.update();
    expect(store.wasCancelled).toBe(false);
  });

  it('clears the progress log when the next operation starts', async () => {
    fakeOperation(okResult, [event]);
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.progressLines).toHaveLength(1);
    fakeOperation(okResult);
    await store.update();
    expect(store.progressLines).toEqual([]);
  });

  it('clears the cancellation notice and the progress log when another copy is opened', async () => {
    fakeOperation(errResult('cancelled'), [event]);
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.wasCancelled).toBe(true);
    expect(store.progressLines).toHaveLength(1);
    await store.open('otra');
    expect(store.wasCancelled).toBe(false);
    expect(store.progressLines).toEqual([]);
  });
});

describe('open feedback', () => {
  it('clears the previous error when another working copy opens cleanly', async () => {
    fakeOperation(errResult('svn_failed'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.error).not.toBeNull();
    await store.open('otra');
    expect(store.error).toBeNull();
  });

  it('keeps the commit draft when the same working copy is reopened', async () => {
    const store = useProjectStore();
    await store.open('wc');
    store.commitDraft = 'borrador';
    await store.open('wc');
    expect(store.commitDraft).toBe('borrador');
  });
});

describe('operations', () => {
  it('ignores update, commit and cleanup when no working copy is open', async () => {
    const store = useProjectStore();
    await store.update();
    await store.commit('m', null);
    await store.cleanup();
    expect(service.runOperation).not.toHaveBeenCalled();
  });

  it('refuses to start a second operation while one is running', async () => {
    const store = useProjectStore();
    await store.open('wc');
    let release: (result: OperationResult) => void = () => undefined;
    vi.mocked(service.runOperation).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const first = store.update();
    expect(store.isBusy).toBe(true);
    await store.update();
    expect(service.runOperation).toHaveBeenCalledTimes(1);
    release(okResult);
    await first;
    expect(store.isBusy).toBe(false);
  });

  it('keeps only the most recent progress lines', async () => {
    const lines: ProgressEvent[] = Array.from(
      { length: MAX_PROGRESS_LINES + 20 },
      (_, index) => ({ kind: 'other', data: `linea ${index}` }),
    );
    fakeOperation(okResult, lines);
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.progressLines).toHaveLength(MAX_PROGRESS_LINES);
    expect(store.progressLines[MAX_PROGRESS_LINES - 1]).toBe(
      `linea ${MAX_PROGRESS_LINES + 19}`,
    );
  });

  it('shows an unexpected rejection of the service as an error and frees the store', async () => {
    vi.mocked(service.runOperation).mockRejectedValue({
      kind: 'io',
      message: 'se cayó',
    });
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.error?.message).toBe('se cayó');
    expect(store.isBusy).toBe(false);
  });

  it('does not refresh after a failed operation', async () => {
    fakeOperation(errResult('svn_failed'));
    const store = useProjectStore();
    await store.open('wc');
    vi.mocked(service.wcInfo).mockClear();
    await store.update();
    expect(service.wcInfo).not.toHaveBeenCalled();
    expect(store.error?.kind).toBe('svn_failed');
  });

  it('offers cleanup after a cancellation only when the backend marked the copy', async () => {
    vi.mocked(service.wcNeedsCleanup).mockResolvedValue(true);
    fakeOperation(errResult('cancelled'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.wasCancelled).toBe(true);
    expect(store.error).toBeNull();
    expect(service.wcNeedsCleanup).toHaveBeenCalledWith('wc');
    expect(store.canCleanup).toBe(true);
  });

  it('does not offer cleanup when the cancelled operation never touched the copy', async () => {
    fakeOperation(errResult('cancelled'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.wasCancelled).toBe(true);
    expect(store.canCleanup).toBe(false);
  });

  it('offers cleanup after a timeout and shows the timeout as an error', async () => {
    vi.mocked(service.wcNeedsCleanup).mockResolvedValue(true);
    fakeOperation(errResult('timed_out'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.error?.kind).toBe('timed_out');
    expect(store.canCleanup).toBe(true);
  });

  it('offers no cleanup after an ordinary failure on an unmarked copy', async () => {
    fakeOperation(errResult('svn_failed'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(service.wcNeedsCleanup).toHaveBeenCalledWith('wc');
    expect(store.canCleanup).toBe(false);
  });

  it('keeps offering cleanup after a cleanup that fails on a marked copy', async () => {
    vi.mocked(service.wcNeedsCleanup).mockResolvedValue(true);
    fakeOperation(errResult('svn_failed'));
    const store = useProjectStore();
    await store.open('wc');
    await store.cleanup();
    expect(store.error?.kind).toBe('svn_failed');
    expect(store.canCleanup).toBe(true);
  });

  it('ignores opening another copy while an operation runs', async () => {
    const store = useProjectStore();
    await store.open('wc');
    vi.mocked(service.runOperation).mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    void store.update();
    vi.mocked(service.wcInfo).mockClear();
    await store.open('otra');
    expect(store.path).toBe('wc');
    expect(service.wcInfo).not.toHaveBeenCalled();
  });

  it('ignores a second open while the first one is still reading', async () => {
    const store = useProjectStore();
    await store.open('wc');
    vi.mocked(service.wcInfo).mockClear();
    vi.mocked(service.wcInfo).mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    void store.open('primera');
    expect(store.isLocked).toBe(true);
    await store.open('segunda');
    expect(store.path).toBe('primera');
    expect(service.wcInfo).toHaveBeenCalledTimes(1);
  });

  it('keeps the store locked while the refresh after an operation reads', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.open('wc');
    vi.mocked(service.wcInfo).mockClear();
    vi.mocked(service.wcInfo).mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    void store.update();
    await flushPromises();
    expect(store.isLocked).toBe(true);
    await store.open('otra');
    expect(store.path).toBe('wc');
    expect(service.wcInfo).toHaveBeenCalledTimes(1);
  });

  it('discards a refresh that resolves after another copy was opened', async () => {
    const store = useProjectStore();
    await store.open('wc');
    let finishStale: (value: service.InfoEntry) => void = () => undefined;
    vi.mocked(service.wcInfo).mockImplementationOnce(
      () => new Promise((resolve) => (finishStale = resolve)),
    );
    const stale = store.refresh();
    const other = { ...info, path: 'otra' } as service.InfoEntry;
    vi.mocked(service.wcInfo).mockResolvedValueOnce(other);
    await store.open('otra');
    finishStale(info);
    await stale;
    expect(store.path).toBe('otra');
    expect(store.info).toEqual(other);
  });

  it('discards the failure of a refresh that belongs to another copy', async () => {
    const store = useProjectStore();
    await store.open('wc');
    let failStale: (reason: unknown) => void = () => undefined;
    vi.mocked(service.wcInfo).mockImplementationOnce(
      () => new Promise((_resolve, reject) => (failStale = reject)),
    );
    const stale = store.refresh();
    await store.open('otra');
    failStale(new Error('tarde'));
    await stale;
    expect(store.error).toBeNull();
    expect(store.info).toEqual(info);
  });

  it('discards a manual refresh that resolves after the refresh of a later operation', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.open('wc');
    let finishStale: (value: service.InfoEntry) => void = () => undefined;
    vi.mocked(service.wcInfo).mockImplementationOnce(
      () => new Promise((resolve) => (finishStale = resolve)),
    );
    const stale = store.refresh();
    const fresh = { ...info, revision: 99 } as service.InfoEntry;
    vi.mocked(service.wcInfo).mockResolvedValue(fresh);
    await store.update();
    finishStale(info);
    await stale;
    expect(store.info).toEqual(fresh);
  });

  it('keeps the cleanup offer of the previous copy when opening another one fails', async () => {
    vi.mocked(service.wcNeedsCleanup).mockResolvedValue(true);
    fakeOperation(errResult('cancelled'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.canCleanup).toBe(true);
    vi.mocked(service.wcInfo).mockRejectedValueOnce(new Error('no es copia'));
    await store.open('otra');
    expect(store.path).toBe('wc');
    expect(store.canCleanup).toBe(true);
  });

  it('offers cleanup when reading a locked working copy fails', async () => {
    const store = useProjectStore();
    await store.open('wc');
    vi.mocked(service.wcInfo).mockRejectedValueOnce({
      kind: 'working_copy_locked',
      message: 'bloqueada',
    });
    await store.refresh();
    expect(store.canCleanup).toBe(true);
  });

  it('does not offer cleanup when reading fails for another reason', async () => {
    const store = useProjectStore();
    await store.open('wc');
    vi.mocked(service.wcInfo).mockRejectedValueOnce({
      kind: 'io',
      message: 'disco',
    });
    await store.refresh();
    expect(store.canCleanup).toBe(false);
  });

  it('unlocks the store when an open fails', async () => {
    vi.mocked(service.wcInfo).mockRejectedValueOnce(new Error('falla'));
    const store = useProjectStore();
    await store.open('wc');
    expect(store.isLocked).toBe(false);
  });

  it('ignores an update requested while a copy is being opened', async () => {
    const store = useProjectStore();
    await store.open('wc');
    vi.mocked(service.wcInfo).mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    void store.open('otra');
    await store.update();
    expect(service.runOperation).not.toHaveBeenCalled();
  });

  it('hides cleanup when the backend cannot answer whether the copy is marked', async () => {
    vi.mocked(service.wcNeedsCleanup).mockRejectedValue(
      new Error('sin respuesta'),
    );
    fakeOperation(errResult('cancelled'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.wasCancelled).toBe(true);
    expect(store.canCleanup).toBe(false);
  });

  it('cleans the checkout destination, not the previously opened copy, after a cancelled checkout', async () => {
    vi.mocked(service.wcNeedsCleanup).mockResolvedValue(true);
    fakeOperation(errResult('cancelled'));
    const store = useProjectStore();
    await store.open('wc');
    await store.checkout('http://h/r', 'dest');
    expect(service.wcNeedsCleanup).toHaveBeenCalledWith('dest');
    fakeOperation(okResult);
    await store.cleanup();
    expect(service.wcCleanup).toHaveBeenCalledWith({ path: 'dest' });
  });

  it('keeps the retry of the running operation when another call is rejected as busy', async () => {
    const store = useProjectStore();
    await store.open('wc');
    let release: (result: OperationResult) => void = () => undefined;
    vi.mocked(service.runOperation).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const first = store.update();
    await store.commit('m', null);
    release(errResult('auth_required'));
    await first;
    fakeOperation(okResult);
    await store.retryWithCredentials({ username: 'alice', password: 'p' });
    expect(service.wcUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ username: 'alice' }),
    );
    expect(service.wcCommit).not.toHaveBeenCalled();
  });

  it.each(['svn_failed', 'cancelled'])(
    'keeps the opened copy when a checkout ends with %s',
    async (kind) => {
      fakeOperation(errResult(kind));
      const store = useProjectStore();
      await store.open('wc');
      await store.checkout('http://h/r', 'dest');
      expect(store.path).toBe('wc');
      expect(service.wcInfo).toHaveBeenCalledTimes(1);
    },
  );

  it('builds the update request exactly as the backend contract lists it', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(service.wcUpdate).toHaveBeenCalledWith(uiRequests.update);
  });

  it('builds the checkout request exactly as the backend contract lists it', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.checkout(uiRequests.checkout.url, uiRequests.checkout.dest, {
      username: uiRequests.checkout.username,
      password: uiRequests.checkout.password,
    });
    expect(service.svnCheckout).toHaveBeenCalledWith(uiRequests.checkout);
  });

  it('builds the commit request exactly as the backend contract lists it', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.open('wc');
    await store.commit(uiRequests.commit.message, uiRequests.commit.username);
    expect(service.wcCommit).toHaveBeenCalledWith(uiRequests.commit);
  });

  it('builds the cleanup request exactly as the backend contract lists it', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.open('wc');
    await store.cleanup();
    expect(service.wcCleanup).toHaveBeenCalledWith(uiRequests.cleanup);
  });

  it('uses only the credentials typed in each retry', async () => {
    fakeOperation(errResult('auth_required'));
    const store = useProjectStore();
    await store.checkout('http://h/r', 'dest', {
      username: 'alice',
      password: 'vieja',
    });
    fakeOperation(errResult('auth_required'));
    await store.retryWithCredentials({ username: 'alice', password: 'nueva' });
    expect(service.svnCheckout).toHaveBeenLastCalledWith(
      expect.objectContaining({ password: 'nueva' }),
    );
    await store.retryWithCredentials({ username: 'alice', password: null });
    expect(service.svnCheckout).toHaveBeenLastCalledWith(
      expect.objectContaining({ username: 'alice', password: null }),
    );
  });

  it('does not refresh when the service rejects unexpectedly', async () => {
    vi.mocked(service.runOperation).mockRejectedValue(new Error('boom'));
    const store = useProjectStore();
    await store.open('wc');
    vi.mocked(service.wcInfo).mockClear();
    await store.update();
    expect(service.wcInfo).not.toHaveBeenCalled();
    expect(store.error?.message).toBe('boom');
  });

  it('offers cleanup for a locked working copy and hides it after a clean run', async () => {
    fakeOperation(errResult('working_copy_locked'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.canCleanup).toBe(true);
    fakeOperation(okResult);
    await store.cleanup();
    expect(store.canCleanup).toBe(false);
    expect(service.wcCleanup).toHaveBeenCalledWith({ path: 'wc' });
  });

  it('refreshes info and status after a successful update', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.open('wc');
    vi.mocked(service.wcInfo).mockClear();
    await store.update();
    expect(service.wcUpdate).toHaveBeenCalledWith({
      path: 'wc',
      revision: null,
      ignore_externals: false,
      username: null,
      password: null,
    });
    expect(service.wcInfo).toHaveBeenCalledTimes(1);
  });

  it('sends the commit message and username but never a password', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.open('wc');
    await store.commit('alta ñandú', 'alice');
    expect(service.wcCommit).toHaveBeenCalledWith({
      path: 'wc',
      message: 'alta ñandú',
      username: 'alice',
      password: null,
    });
  });

  it('switches to the checked out working copy after a successful checkout', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.checkout('https://h/r', 'copia');
    expect(service.svnCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://h/r', dest: 'copia' }),
    );
    expect(store.path).toBe('copia');
    expect(service.wcInfo).toHaveBeenCalledWith('copia');
  });
});

describe('credentials', () => {
  it('retries the failed operation with the typed credentials and never stores the password', async () => {
    fakeOperation(errResult('auth_required'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.error?.kind).toBe('auth_required');
    fakeOperation(okResult);
    await store.retryWithCredentials({ username: 'alice', password: 's3cret' });
    expect(service.wcUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ username: 'alice', password: 's3cret' }),
    );
    expect(store.error).toBeNull();
    expect(JSON.stringify(store.$state)).not.toContain('s3cret');
  });

  it('forgets the retry once the operation completes', async () => {
    fakeOperation(errResult('auth_required'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    fakeOperation(okResult);
    await store.retryWithCredentials({ username: 'alice', password: 'x' });
    vi.mocked(service.runOperation).mockClear();
    await store.retryWithCredentials({ username: 'alice', password: 'x' });
    expect(service.runOperation).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing to retry', async () => {
    const store = useProjectStore();
    await store.retryWithCredentials({ username: 'a', password: 'b' });
    expect(service.runOperation).not.toHaveBeenCalled();
  });
});

describe('cancel', () => {
  it('does nothing before the backend assigned an operation id', async () => {
    const store = useProjectStore();
    await store.cancel();
    expect(service.opCancel).not.toHaveBeenCalled();
  });

  it('asks the backend to cancel the running operation by id', async () => {
    const store = useProjectStore();
    await store.open('wc');
    let release: (result: OperationResult) => void = () => undefined;
    vi.mocked(service.runOperation).mockImplementationOnce(
      (start) =>
        new Promise((resolve) => {
          release = resolve;
          void start();
        }),
    );
    vi.mocked(service.opCancel).mockResolvedValue(true);
    const running = store.update();
    await vi.waitFor(() => expect(store.operation?.id).toBe(11));
    await store.cancel();
    expect(service.opCancel).toHaveBeenCalledWith(11);
    release(errResult('cancelled'));
    await running;
  });

  it('shows the error when the cancel request itself fails', async () => {
    const store = useProjectStore();
    await store.open('wc');
    let release: (result: OperationResult) => void = () => undefined;
    vi.mocked(service.runOperation).mockImplementationOnce(
      (start) =>
        new Promise((resolve) => {
          release = resolve;
          void start();
        }),
    );
    vi.mocked(service.opCancel).mockRejectedValue({
      kind: 'io',
      message: 'no se pudo cancelar',
    });
    const running = store.update();
    await vi.waitFor(() => expect(store.operation?.id).toBe(11));
    await store.cancel();
    expect(store.error?.message).toBe('no se pudo cancelar');
    release(okResult);
    await running;
  });
});

describe('cleanup of an explicit target and finished operations', () => {
  it('cleans the explicit target instead of the open copy or the offered one', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.open('wc');
    await store.cleanup('bloqueada');
    expect(service.wcCleanup).toHaveBeenCalledWith({ path: 'bloqueada' });
  });

  it('still cleans the open copy when no target is given', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.open('wc');
    await store.cleanup();
    expect(service.wcCleanup).toHaveBeenCalledWith({ path: 'wc' });
  });

  it('counts an operation that failed, was cancelled or succeeded, but not a rejected start', async () => {
    const store = useProjectStore();
    await store.open('wc');
    expect(store.finishedOperations).toBe(0);
    fakeOperation(errResult('svn_failed'));
    await store.update();
    fakeOperation(errResult('cancelled'));
    await store.update();
    fakeOperation(okResult);
    await store.update();
    expect(store.finishedOperations).toBe(3);
  });

  it('counts the operation only after its follow-up refresh finished', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.open('wc');
    let release: (value: service.InfoEntry) => void = () => undefined;
    vi.mocked(service.wcInfo).mockReturnValueOnce(
      new Promise((resolve) => (release = resolve)),
    );
    const running = store.update();
    await flushPromises();
    expect(store.finishedOperations).toBe(0);
    release(info);
    await running;
    expect(store.finishedOperations).toBe(1);
  });

  it('does not count a request ignored because the store is locked', async () => {
    fakeOperation(okResult);
    const store = useProjectStore();
    await store.open('wc');
    vi.mocked(service.wcInfo).mockReturnValueOnce(new Promise(() => undefined));
    void store.open('otra');
    await store.update();
    expect(store.finishedOperations).toBe(0);
  });
});

describe('explorer reload after an operation', () => {
  function watchedStores() {
    const explorer = useExplorerStore();
    const reload = vi
      .spyOn(explorer, 'reloadAfterChange')
      .mockResolvedValue(undefined);
    return { reload, store: useProjectStore() };
  }

  it('does not reload when the request is ignored because the store is locked', async () => {
    const { reload, store } = watchedStores();
    vi.mocked(service.wcInfo).mockReturnValueOnce(new Promise(() => undefined));
    void store.open('wc');
    await store.update();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    ['update', (store: ReturnType<typeof useProjectStore>) => store.update()],
    [
      'commit',
      (store: ReturnType<typeof useProjectStore>) => store.commit('m', null),
    ],
    ['cleanup', (store: ReturnType<typeof useProjectStore>) => store.cleanup()],
  ])(
    'reloads the listing and the states after %s, even if it failed',
    async (_name, run) => {
      const { reload, store } = watchedStores();
      await store.open('wc');
      fakeOperation(errResult('svn_failed'));
      await run(store);
      expect(reload).toHaveBeenCalledTimes(1);
      fakeOperation(okResult);
      await run(store);
      expect(reload).toHaveBeenCalledTimes(2);
    },
  );

  it('reloads after a checkout', async () => {
    const { reload, store } = watchedStores();
    fakeOperation(okResult);
    await store.checkout('svn://h/r', 'nueva');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads before announcing that the operation finished', async () => {
    const { reload, store } = watchedStores();
    await store.open('wc');
    let finishedWhenReloading = -1;
    reload.mockImplementation(async () => {
      finishedWhenReloading = store.finishedOperations;
    });
    fakeOperation(okResult);
    await store.update();
    expect(finishedWhenReloading).toBe(0);
    expect(store.finishedOperations).toBe(1);
  });
});
