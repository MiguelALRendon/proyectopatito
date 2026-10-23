import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../services/tauri', () => ({
  appFrontendReady: vi.fn(),
  appHoldClose: vi.fn(),
  appConfirmClose: vi.fn(),
  appCancelClose: vi.fn(),
  onCloseRequested: vi.fn(),
}));
vi.mock('../services/filesApi', () => ({
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
  fsReadText: vi.fn(),
}));
vi.mock('../documents/dialogs', () => ({ askWindowClose: vi.fn() }));

import { askWindowClose } from '../documents/dialogs';
import { fsReadText, uiStateGet } from '../services/filesApi';
import { useDocumentsStore } from '../stores/documents';
import { useTabsStore } from '../stores/tabs';
import { useTabsSession } from './useTabsSession';
import { appHoldClose } from '../services/tauri';
import { handleCloseRequested } from './useWindowClose';

const emptySession = {
  version: 1,
  favorites: [],
  tabs: [],
  active_tab: null,
  views: {},
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(uiStateGet).mockResolvedValue(emptySession);
  setActivePinia(createPinia());
});

describe('useTabsSession', () => {
  it('does not read the session until the shell is visible', async () => {
    const ready = ref(false);
    const scope = effectScope();
    scope.run(() => useTabsSession(ready));
    await nextTick();
    expect(uiStateGet).not.toHaveBeenCalled();
    ready.value = true;
    await nextTick();
    expect(uiStateGet).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('restores right away when the shell is already visible', async () => {
    const scope = effectScope();
    scope.run(() => useTabsSession(ref(true)));
    await nextTick();
    expect(uiStateGet).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('restores only once however many times the shell becomes visible', async () => {
    const ready = ref(true);
    const scope = effectScope();
    scope.run(() => useTabsSession(ready));
    await nextTick();
    ready.value = false;
    await nextTick();
    ready.value = true;
    await nextTick();
    expect(uiStateGet).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('registers the window close guard and removes it with the scope', async () => {
    const scope = effectScope();
    scope.run(() => useTabsSession(ref(false)));
    await handleCloseRequested();
    expect(appHoldClose).toHaveBeenCalledTimes(1);
    scope.stop();
    vi.mocked(appHoldClose).mockClear();
    await handleCloseRequested();
    expect(appHoldClose).not.toHaveBeenCalled();
  });

  it('keeps the window open when a document has unsaved changes and the user cancels', async () => {
    vi.mocked(askWindowClose).mockResolvedValue(null);
    vi.mocked(fsReadText).mockResolvedValue({
      content: 'uno',
      encoding: 'utf8',
      has_bom: false,
      eol: 'lf',
      eol_mixed: false,
      version: 'v1',
      len: 3,
    });
    const tabs = useTabsStore();
    const documents = useDocumentsStore();
    const scope = effectScope();
    scope.run(() => useTabsSession(ref(false)));
    const tabId = tabs.open('a.txt', 'document') as string;
    await documents.load(tabId, 'a.txt');
    documents.edit(tabId, 'dos');
    const { appCancelClose, appConfirmClose } =
      await import('../services/tauri');
    await handleCloseRequested();
    expect(askWindowClose).toHaveBeenCalledWith(1, false);
    expect(appCancelClose).toHaveBeenCalledTimes(1);
    expect(appConfirmClose).not.toHaveBeenCalled();
    scope.stop();
  });
});
