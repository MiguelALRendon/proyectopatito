import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../services/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/tauri')>()),
  workspaceGet: vi.fn(),
  workspaceSet: vi.fn(),
  svnDetect: vi.fn(),
  svnSetPath: vi.fn(),
}));

import * as service from '../services/tauri';
import { useWorkspaceStore } from './workspace';

const found = (version: string) => ({
  binary: { path: 'C:\\svn.exe', version },
  error: null,
});
const absent = { binary: null, error: 'no se encontró svn.exe' };

beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
});

describe('workspace store', () => {
  it('is not onboarded before loading anything', () => {
    const store = useWorkspaceStore();
    expect(store.isOnboarded).toBe(false);
    expect(store.isLoaded).toBe(false);
  });

  it('keeps the error and still marks itself loaded when loading fails', async () => {
    vi.mocked(service.workspaceGet).mockRejectedValue({
      kind: 'io',
      message: 'sin config',
    });
    vi.mocked(service.svnDetect).mockResolvedValue(found('1.14.2'));
    const store = useWorkspaceStore();
    await store.load();
    expect(store.error?.message).toBe('sin config');
    expect(store.isLoaded).toBe(true);
    expect(store.isOnboarded).toBe(false);
  });

  it('is not onboarded when svn is missing even if the root is set', async () => {
    vi.mocked(service.workspaceGet).mockResolvedValue('C:\\raiz');
    vi.mocked(service.svnDetect).mockResolvedValue(absent);
    const store = useWorkspaceStore();
    await store.load();
    expect(store.root).toBe('C:\\raiz');
    expect(store.hasSvn).toBe(false);
    expect(store.isOnboarded).toBe(false);
  });

  it('setRoot reports the backend error and keeps the previous root', async () => {
    vi.mocked(service.workspaceGet).mockResolvedValue('C:\\vieja');
    vi.mocked(service.svnDetect).mockResolvedValue(found('1.14.2'));
    vi.mocked(service.workspaceSet).mockRejectedValue({
      kind: 'invalid_path',
      message: 'no existe',
    });
    const store = useWorkspaceStore();
    await store.load();
    await expect(store.setRoot('C:\\nada')).resolves.toBe(false);
    expect(store.root).toBe('C:\\vieja');
    expect(store.error?.kind).toBe('invalid_path');
  });

  it('becomes onboarded once root and svn are available and clears old errors', async () => {
    vi.mocked(service.workspaceGet).mockResolvedValue(null);
    vi.mocked(service.svnDetect).mockResolvedValue(absent);
    vi.mocked(service.workspaceSet).mockResolvedValue('C:\\raiz');
    vi.mocked(service.svnSetPath).mockResolvedValue(found('1.14.2'));
    const store = useWorkspaceStore();
    await store.load();
    await expect(store.setRoot('C:\\raiz')).resolves.toBe(true);
    await expect(store.setSvnPath('C:\\svn.exe')).resolves.toBe(true);
    expect(store.error).toBeNull();
    expect(store.svnVersion).toBe('1.14.2');
    expect(store.isOnboarded).toBe(true);
  });
});

describe('workspace store svn actions after a valid detection', () => {
  async function loadedStore() {
    vi.mocked(service.workspaceGet).mockResolvedValue('C:\\raiz');
    vi.mocked(service.svnDetect).mockResolvedValue(found('1.14.2'));
    const store = useWorkspaceStore();
    await store.load();
    return store;
  }

  it('reports success only for a clean detection', async () => {
    const store = await loadedStore();
    vi.mocked(service.svnSetPath).mockResolvedValue(found('1.15.0'));
    expect(await store.setSvnPath('C:\\svn.exe')).toBe(true);
    expect(store.svnVersion).toBe('1.15.0');
  });

  it.each([
    ['no binary', absent],
    [
      'a binary that could not be saved',
      { ...found('1.9.9'), error: 'no se pudo guardar' },
    ],
  ])('reports failure for %s', async (_label, detection) => {
    const store = await loadedStore();
    vi.mocked(service.svnSetPath).mockResolvedValue(detection);
    expect(await store.setSvnPath('C:\\svn.exe')).toBe(false);
  });

  it('reports failure and keeps the previous detection when saving is rejected', async () => {
    const store = await loadedStore();
    vi.mocked(service.svnSetPath).mockRejectedValue({
      kind: 'io',
      message: 'disco lleno',
    });
    expect(await store.setSvnPath('C:\\svn.exe')).toBe(false);
    expect(store.error?.message).toBe('disco lleno');
    expect(store.svnVersion).toBe('1.14.2');
  });

  it('keeps the working client and shows why when the new path is invalid', async () => {
    const store = await loadedStore();
    vi.mocked(service.svnSetPath).mockResolvedValue(absent);
    expect(await store.setSvnPath('C:\\malo.exe')).toBe(false);
    expect(store.svnVersion).toBe('1.14.2');
    expect(store.svn?.error).toBe(absent.error);
    expect(store.isOnboarded).toBe(true);
  });

  it('reports failure when a new detection finds nothing', async () => {
    const store = await loadedStore();
    vi.mocked(service.svnDetect).mockResolvedValue(absent);
    expect(await store.detectSvn()).toBe(false);
  });

  it('reports failure when a new detection is rejected', async () => {
    const store = await loadedStore();
    vi.mocked(service.svnDetect).mockRejectedValue(new Error('sin permisos'));
    expect(await store.detectSvn()).toBe(false);
  });
});
