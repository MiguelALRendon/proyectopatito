import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: { payload: unknown }) => void;

const handlers = new Map<string, Handler>();
const unlisten = vi.fn();
const invokeMock = vi.fn();
const openMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: Handler) => {
    handlers.set(name, handler);
    return Promise.resolve(unlisten);
  },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

import {
  DONE_EVENT,
  PROGRESS_EVENT,
  normalizeError,
  pickDirectory,
  runOperation,
  wcNeedsCleanup,
  wcStatus,
  workspaceSet,
  type ProgressEvent,
} from './tauri';

function emit(name: string, payload: unknown) {
  handlers.get(name)?.({ payload });
}

const itemEvent: ProgressEvent = {
  kind: 'item',
  data: { action: 'added', path: 'a.txt' },
};

const authError = {
  status: 'err',
  kind: 'auth_required',
  message: 'x',
  codes: [],
  detail: null,
};

beforeEach(() => {
  handlers.clear();
  unlisten.mockReset();
  invokeMock.mockReset();
  openMock.mockReset();
});

describe('normalizeError', () => {
  it('keeps a well formed backend error', () => {
    const raw = {
      kind: 'auth_required',
      message: 'x',
      codes: ['E170001'],
      detail: 'd',
    };
    expect(normalizeError(raw)).toEqual(raw);
  });

  it('turns an unknown kind into an io error', () => {
    const error = normalizeError({ kind: 'inventado', message: 'raro' });
    expect(error.kind).toBe('io');
  });

  it('wraps strings, Error instances and null', () => {
    expect(normalizeError('boom')).toMatchObject({
      kind: 'io',
      message: 'boom',
    });
    expect(normalizeError(new Error('falló'))).toMatchObject({
      kind: 'io',
      message: 'falló',
    });
    expect(normalizeError(null).kind).toBe('io');
  });

  it('defaults codes and detail when the backend mistypes them', () => {
    const error = normalizeError({
      kind: 'svn_failed',
      message: 'm',
      codes: 'no-es-lista',
      detail: 5,
    });
    expect(error.codes).toEqual([]);
    expect(error.detail).toBeNull();
  });

  it('does not trust a known kind whose message is not a string', () => {
    expect(normalizeError({ kind: 'cancelled', message: 3 }).kind).toBe('io');
  });
});

describe('command wrappers', () => {
  it('passes arguments named like the Rust parameters', async () => {
    invokeMock.mockResolvedValue('C:\\raiz');
    await workspaceSet('C:\\raiz');
    expect(invokeMock).toHaveBeenCalledWith('workspace_set', {
      path: 'C:\\raiz',
    });
  });

  it('asks for local status unless remote is requested', async () => {
    invokeMock.mockResolvedValue({ entries: [], against_revision: null });
    await wcStatus('wc');
    await wcStatus('wc', true);
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'wc_status', {
      path: 'wc',
      remote: false,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'wc_status', {
      path: 'wc',
      remote: true,
    });
  });

  it('asks the backend whether a copy needs cleanup', async () => {
    invokeMock.mockResolvedValue(true);
    await expect(wcNeedsCleanup('wc')).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('wc_needs_cleanup', { path: 'wc' });
  });

  it('normalizes a rejected invoke into a CommandError', async () => {
    invokeMock.mockRejectedValue({
      kind: 'outside_workspace',
      message: 'fuera',
    });
    await expect(workspaceSet('..')).rejects.toMatchObject({
      kind: 'outside_workspace',
      codes: [],
    });
  });

  it('returns the picked folder and normalizes dialog failures', async () => {
    openMock.mockResolvedValueOnce('C:\\carpeta');
    await expect(pickDirectory()).resolves.toBe('C:\\carpeta');
    openMock.mockRejectedValueOnce('sin permiso');
    await expect(pickDirectory()).rejects.toMatchObject({
      kind: 'io',
      message: 'sin permiso',
    });
    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
    });
  });
});

describe('runOperation', () => {
  it('delivers progress in order and resolves with the done result', async () => {
    const seen: ProgressEvent[] = [];
    const run = runOperation(
      async () => {
        queueMicrotask(() => {
          emit(PROGRESS_EVENT, { id: 7, event: itemEvent });
          emit(DONE_EVENT, { id: 7, result: { status: 'ok', revision: 3 } });
        });
        return 7;
      },
      (event) => seen.push(event),
    );
    await expect(run).resolves.toEqual({ status: 'ok', revision: 3 });
    expect(seen).toEqual([itemEvent]);
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it('delivers events that arrive after the operation id is known', async () => {
    const seen: ProgressEvent[] = [];
    const run = runOperation(
      async () => {
        setTimeout(() => {
          emit(PROGRESS_EVENT, { id: 12, event: itemEvent });
          emit(DONE_EVENT, { id: 12, result: { status: 'ok', revision: 8 } });
        }, 0);
        return 12;
      },
      (event) => seen.push(event),
    );
    await expect(run).resolves.toEqual({ status: 'ok', revision: 8 });
    expect(seen).toEqual([itemEvent]);
  });

  it('buffers events that arrive before the operation id is known', async () => {
    const seen: ProgressEvent[] = [];
    let release: (id: number) => void = () => undefined;
    const gate = new Promise<number>((resolve) => (release = resolve));
    const run = runOperation(
      () => gate,
      (event) => seen.push(event),
    );
    await Promise.resolve();
    emit(PROGRESS_EVENT, { id: 9, event: itemEvent });
    emit(DONE_EVENT, { id: 9, result: { status: 'ok', revision: null } });
    release(9);
    await expect(run).resolves.toEqual({ status: 'ok', revision: null });
    expect(seen).toEqual([itemEvent]);
  });

  it('ignores progress and done events of other operations', async () => {
    const seen: ProgressEvent[] = [];
    const run = runOperation(
      async () => {
        queueMicrotask(() => {
          emit(PROGRESS_EVENT, { id: 1, event: itemEvent });
          emit(DONE_EVENT, { id: 1, result: { status: 'ok', revision: 1 } });
          emit(DONE_EVENT, { id: 2, result: { status: 'ok', revision: 2 } });
        });
        return 2;
      },
      (event) => seen.push(event),
    );
    await expect(run).resolves.toEqual({ status: 'ok', revision: 2 });
    expect(seen).toEqual([]);
  });

  it('returns backend errors reported through the done event', async () => {
    const run = runOperation(
      async () => {
        queueMicrotask(() => emit(DONE_EVENT, { id: 4, result: authError }));
        return 4;
      },
      () => undefined,
    );
    await expect(run).resolves.toMatchObject({
      status: 'err',
      kind: 'auth_required',
    });
  });

  it('normalizes a failing start and still stops listening', async () => {
    const run = runOperation(
      () => Promise.reject({ kind: 'invalid_path', message: 'mala ruta' }),
      () => undefined,
    );
    await expect(run).rejects.toMatchObject({ kind: 'invalid_path' });
    expect(unlisten).toHaveBeenCalledTimes(2);
  });
});
