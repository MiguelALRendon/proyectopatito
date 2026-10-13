import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../services/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/tauri')>()),
  wcInfo: vi.fn(),
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
import { MAX_PROGRESS_LINES, useProjectStore } from './project';

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

  it('treats a cancelled result as cancellation, not as an error, and offers cleanup', async () => {
    fakeOperation(errResult('cancelled'));
    const store = useProjectStore();
    await store.open('wc');
    await store.update();
    expect(store.wasCancelled).toBe(true);
    expect(store.error).toBeNull();
    expect(store.canCleanup).toBe(true);
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
