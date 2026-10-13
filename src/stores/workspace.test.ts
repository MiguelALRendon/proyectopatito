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
