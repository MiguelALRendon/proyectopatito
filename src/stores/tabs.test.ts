import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../services/filesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/filesApi')>()),
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
}));
vi.mock('../composables/useConfirm', () => ({ confirm: vi.fn() }));

import { confirm } from '../composables/useConfirm';
import {
  uiStateGet,
  uiStateSet,
  type Located,
  type Tab,
  type UiStateView,
} from '../services/filesApi';
import { MAX_FAVORITES } from '../utils/favoriteList';
import { SAVE_SETTLE_TIMEOUT_MS } from '../documents/limits';
import { normalizedPath, pathKey } from '../utils/folderPaths';
import {
  FAVORITES_LIMIT_NOTICE,
  LIMIT_NOTICE,
  MAX_TABS,
  PERSIST_DELAY_MS,
  RESTORE_FAILED_NOTICE,
  SAVE_FAILED_NOTICE,
  omittedNotice,
  tabTitle,
  useTabsStore,
} from './tabs';

const VIEW_KEY = 'docs';

function savedTab(path: string, exists = true): Located<Tab> {
  return { id: `id-${path}`, kind: 'folder', path, title: path, exists };
}

function sessionView(overrides: Partial<UiStateView> = {}): UiStateView {
  return {
    version: 1,
    favorites: [{ path: 'fav', name: 'Fav', exists: true }],
    tabs: [],
    active_tab: null,
    views: {
      [VIEW_KEY]: {
        mode: 'grid',
        columns: ['type'],
        sort: 'name',
        sort_direction: 'asc',
        updated_ms: 7,
        exists: true,
      },
    },
    ...overrides,
  };
}

function freshStore() {
  setActivePinia(createPinia());
  return useTabsStore();
}

async function restoredStore(overrides: Partial<UiStateView> = {}) {
  vi.mocked(uiStateGet).mockResolvedValue(sessionView(overrides));
  const store = freshStore();
  await store.restore();
  return store;
}

function openMany(store: ReturnType<typeof freshStore>, paths: string[]) {
  return paths.map((path) => store.open(path) as string);
}

function paths(store: ReturnType<typeof freshStore>) {
  return store.tabs.map((tab) => tab.path);
}

function lastWrite() {
  const calls = vi.mocked(uiStateSet).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.mocked(uiStateSet).mockResolvedValue(sessionView());
});

afterEach(() => vi.useRealTimers());

describe('path helpers', () => {
  it('normalizes separators, repeated separators and trailing separators', () => {
    expect(normalizedPath('\\a//b\\\\c\\')).toBe('a\\b\\c');
    expect(normalizedPath('')).toBe('');
    expect(normalizedPath('///')).toBe('');
  });

  it('builds a lowercase key that ignores separator style', () => {
    expect(pathKey('Docs/Sub')).toBe(pathKey('docs\\SUB\\'));
  });

  it('titles a tab by its last segment and the root by the shell name', () => {
    expect(tabTitle('a/b/Informe')).toBe('Informe');
    expect(tabTitle('')).toBe('Mis archivos');
  });

  it('uses singular and plural wording in the omitted notice', () => {
    expect(omittedNotice(1)).toContain('1 pestaña');
    expect(omittedNotice(3)).toContain('3 pestañas');
  });
});

describe('open and duplicate', () => {
  it('does not duplicate a path that only differs in case or separators', () => {
    const store = freshStore();
    const first = store.open('Docs\\Sub');
    store.open('other');
    const again = store.open('docs/SUB/');
    expect(again).toBe(first);
    expect(store.tabs).toHaveLength(2);
    expect(store.activeId).toBe(first);
  });

  it('opens the workspace root once', () => {
    const store = freshStore();
    store.open('');
    store.open('\\');
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].title).toBe('Mis archivos');
  });

  it('allows an explicit duplicate right after the original and activates it', () => {
    const store = freshStore();
    const [a] = openMany(store, ['a', 'b']);
    const copy = store.duplicate(a);
    expect(paths(store)).toEqual(['a', 'a', 'b']);
    expect(store.tabs[1].id).toBe(copy);
    expect(store.activeId).toBe(copy);
    expect(copy).not.toBe(a);
  });

  it('opening a path that has a duplicate activates the first match', () => {
    const store = freshStore();
    const [a] = openMany(store, ['a']);
    store.duplicate(a);
    store.open('A');
    expect(store.activeId).toBe(a);
  });

  it('refuses to duplicate an unknown tab', () => {
    const store = freshStore();
    expect(store.duplicate('nope')).toBeNull();
  });

  it('refuses a new tab past MAX_TABS with a notice but still activates existing ones', () => {
    const store = freshStore();
    const all = Array.from({ length: MAX_TABS }, (_, index) => `p${index}`);
    const ids = openMany(store, all);
    expect(store.canOpen).toBe(false);
    expect(store.open('extra')).toBeNull();
    expect(store.duplicate(ids[0])).toBeNull();
    expect(store.tabs).toHaveLength(MAX_TABS);
    expect(store.notice).toBe(LIMIT_NOTICE);
    expect(store.open('P3')).toBe(ids[3]);
    expect(store.activeId).toBe(ids[3]);
  });

  it('keeps the document kind and an explicit title', () => {
    const store = freshStore();
    store.open('a/readme.md', 'document', 'LEEME');
    expect(store.activeTab).toMatchObject({
      kind: 'document',
      path: 'a\\readme.md',
      title: 'LEEME',
    });
  });

  it('navigating inside a tab changes its location without deduplicating', () => {
    const store = freshStore();
    const [a] = openMany(store, ['a', 'b']);
    store.navigate(a, 'b');
    expect(paths(store)).toEqual(['b', 'b']);
    expect(store.tabs[0].title).toBe('b');
    store.navigate('nope', 'z');
    expect(paths(store)).toEqual(['b', 'b']);
  });
});

describe('close and active tab', () => {
  it('activates the right neighbour when the active middle tab closes', async () => {
    const store = freshStore();
    const [a, b, c] = openMany(store, ['a', 'b', 'c']);
    store.activate(b);
    expect(await store.close(b)).toBe(true);
    expect(store.activeId).toBe(c);
    expect(store.tabs.map((tab) => tab.id)).toEqual([a, c]);
  });

  it('activates the left neighbour when the last tab closes', async () => {
    const store = freshStore();
    const [, b, c] = openMany(store, ['a', 'b', 'c']);
    await store.close(c);
    expect(store.activeId).toBe(b);
  });

  it('keeps the active tab when another one closes', async () => {
    const store = freshStore();
    const [a, b] = openMany(store, ['a', 'b']);
    store.activate(b);
    await store.close(a);
    expect(store.activeId).toBe(b);
  });

  it('leaves no active tab after closing the only one', async () => {
    const store = freshStore();
    const [a] = openMany(store, ['a']);
    await store.close(a);
    expect(store.activeId).toBeNull();
    expect(store.activeTab).toBeNull();
  });

  it('returns false and changes nothing for an unknown tab', async () => {
    const store = freshStore();
    openMany(store, ['a']);
    expect(await store.close('nope')).toBe(false);
    expect(store.tabs).toHaveLength(1);
  });

  it('closeOthers keeps only the anchor and makes it active', async () => {
    const store = freshStore();
    const [, b] = openMany(store, ['a', 'b', 'c']);
    expect(await store.closeOthers(b)).toBe(true);
    expect(store.tabs.map((tab) => tab.id)).toEqual([b]);
    expect(store.activeId).toBe(b);
  });

  it('closeOthers with an unknown id does not close anything', async () => {
    const store = freshStore();
    openMany(store, ['a', 'b']);
    expect(await store.closeOthers('nope')).toBe(false);
    expect(store.tabs).toHaveLength(2);
  });

  it('closeOthers on a single tab is a no-op', async () => {
    const store = freshStore();
    const [a] = openMany(store, ['a']);
    expect(await store.closeOthers(a)).toBe(false);
    expect(store.tabs).toHaveLength(1);
  });

  it('closeToTheRight activates the anchor when the active tab was on the right', async () => {
    const store = freshStore();
    const [a, b] = openMany(store, ['a', 'b', 'c', 'd']);
    expect(store.activeId).not.toBe(b);
    await store.closeToTheRight(b);
    expect(store.tabs.map((tab) => tab.id)).toEqual([a, b]);
    expect(store.activeId).toBe(b);
  });

  it('closeToTheRight keeps an active tab that is on the left', async () => {
    const store = freshStore();
    const [a, b] = openMany(store, ['a', 'b', 'c']);
    store.activate(a);
    await store.closeToTheRight(b);
    expect(store.activeId).toBe(a);
  });

  it('closeToTheRight on the last tab or an unknown tab does nothing', async () => {
    const store = freshStore();
    const ids = openMany(store, ['a', 'b']);
    expect(await store.closeToTheRight(ids[1])).toBe(false);
    expect(await store.closeToTheRight('nope')).toBe(false);
    expect(store.tabs).toHaveLength(2);
  });
});

describe('reorder', () => {
  it('moves a tab and clamps targets outside the list', () => {
    const store = freshStore();
    const [a, , c] = openMany(store, ['a', 'b', 'c']);
    store.move(a, 99);
    expect(paths(store)).toEqual(['b', 'c', 'a']);
    store.move(c, -5);
    expect(paths(store)).toEqual(['c', 'b', 'a']);
  });

  it('ignores unknown ids, non-integer targets and moves to the same slot', async () => {
    const store = await restoredStore({ tabs: [savedTab('a'), savedTab('b')] });
    store.move('nope', 0);
    store.move('id-a', Number.NaN);
    store.move('id-a', 0);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(paths(store)).toEqual(['a', 'b']);
    expect(uiStateSet).not.toHaveBeenCalled();
  });

  it('keeps the active tab when the order changes', () => {
    const store = freshStore();
    const [a, b] = openMany(store, ['a', 'b']);
    store.move(b, 0);
    expect(store.activeId).toBe(b);
    expect(store.tabs[1].id).toBe(a);
  });
});

describe('dirty tabs', () => {
  it('ignores setDirty on an unknown tab', () => {
    const store = freshStore();
    store.setDirty('nope', true);
    expect(store.hasDirtyTabs).toBe(false);
  });

  it('tracks and clears the dirty state', () => {
    const store = freshStore();
    const [a, b] = openMany(store, ['a', 'b']);
    store.setDirty(a, true);
    store.setDirty(a, true);
    expect(store.isDirty(a)).toBe(true);
    expect(store.isDirty(b)).toBe(false);
    expect(store.hasDirtyTabs).toBe(true);
    store.setDirty(a, false);
    expect(store.hasDirtyTabs).toBe(false);
  });

  it('keeps a dirty tab and its flag when the user cancels the confirmation', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const store = freshStore();
    const [a] = openMany(store, ['a', 'b']);
    store.setDirty(a, true);
    expect(await store.close(a)).toBe(false);
    expect(store.tabs).toHaveLength(2);
    expect(store.isDirty(a)).toBe(true);
    expect(vi.mocked(confirm).mock.calls[0][0]).toContain('«a»');
  });

  it('closes a dirty tab after confirming and forgets its flag', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    const store = freshStore();
    const [a] = openMany(store, ['a', 'b']);
    store.setDirty(a, true);
    expect(await store.close(a)).toBe(true);
    expect(store.tabs).toHaveLength(1);
    expect(store.hasDirtyTabs).toBe(false);
  });

  it('does not ask for confirmation to close clean tabs', async () => {
    const store = freshStore();
    const [a] = openMany(store, ['a']);
    await store.close(a);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks once for several dirty tabs and keeps all of them on cancel', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const store = freshStore();
    const [a, b, c] = openMany(store, ['a', 'b', 'c']);
    store.setDirty(a, true);
    store.setDirty(c, true);
    expect(await store.closeOthers(b)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirm).mock.calls[0][0]).toContain('2 pestañas');
    expect(store.tabs).toHaveLength(3);
  });

  it('does not count a clean tab closed with others as dirty', async () => {
    const store = freshStore();
    const [a, b] = openMany(store, ['a', 'b']);
    store.setDirty(a, true);
    expect(await store.closeToTheRight(a)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(store.tabs.map((tab) => tab.id)).toEqual([a]);
    expect(store.tabs.some((tab) => tab.id === b)).toBe(false);
  });
});

describe('restore', () => {
  it('omits tabs whose path no longer exists and warns', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a'), savedTab('gone', false), savedTab('b')],
      active_tab: 'id-b',
    });
    expect(paths(store)).toEqual(['a', 'b']);
    expect(store.activeId).toBe('id-b');
    expect(store.notice).toBe(omittedNotice(1));
  });

  it('pluralizes the warning for several omitted tabs', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a'), savedTab('x', false), savedTab('y', false)],
    });
    expect(store.notice).toBe(omittedNotice(2));
  });

  it('falls back to the first kept tab when the active one was omitted', async () => {
    const store = await restoredStore({
      tabs: [savedTab('gone', false), savedTab('a')],
      active_tab: 'id-gone',
    });
    expect(store.activeId).toBe('id-a');
  });

  it('falls back to the first kept tab when the saved active id is unknown or null', async () => {
    const unknown = await restoredStore({
      tabs: [savedTab('a'), savedTab('b')],
      active_tab: 'zzz',
    });
    expect(unknown.activeId).toBe('id-a');
    const none = await restoredStore({
      tabs: [savedTab('a')],
      active_tab: null,
    });
    expect(none.activeId).toBe('id-a');
  });

  it('opens the root when nothing survives and says why', async () => {
    const store = await restoredStore({
      tabs: [savedTab('gone', false)],
      active_tab: 'id-gone',
    });
    expect(paths(store)).toEqual(['']);
    expect(store.notice).toBe(omittedNotice(1));
  });

  it('opens the root on a first run without any saved session', async () => {
    const store = await restoredStore();
    expect(paths(store)).toEqual(['']);
    expect(store.notice).toBeNull();
  });

  it('keeps saved duplicates, the one allowed exception', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a'), { ...savedTab('a'), id: 'copy' }],
    });
    expect(store.tabs.map((tab) => tab.id)).toEqual(['id-a', 'copy']);
  });

  it('strips the exists flag from restored tabs', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    expect(store.tabs[0]).not.toHaveProperty('exists');
  });

  it('survives a failing uiStateGet: root tab, notice and no writes that could wipe the config', async () => {
    vi.mocked(uiStateGet).mockRejectedValue(new Error('boom'));
    const store = freshStore();
    await store.restore();
    expect(paths(store)).toEqual(['']);
    expect(store.notice).toBe(RESTORE_FAILED_NOTICE);
    store.open('a');
    await store.flush();
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(uiStateSet).not.toHaveBeenCalled();
  });

  it('reads the session once however many times restore is called', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    store.open('b');
    await store.restore();
    expect(uiStateGet).toHaveBeenCalledTimes(1);
    expect(paths(store)).toEqual(['a', 'b']);
  });

  it('flags the restore as running until the session is applied', async () => {
    let finish: (view: UiStateView) => void = () => undefined;
    vi.mocked(uiStateGet).mockReturnValue(
      new Promise<UiStateView>((done) => (finish = done)),
    );
    const store = freshStore();
    const pending = store.restore();
    expect(store.isRestoring).toBe(true);
    finish(sessionView({ tabs: [savedTab('a')] }));
    await pending;
    expect(store.isRestoring).toBe(false);
    expect(paths(store)).toEqual(['a']);
  });

  it('clears the running flag when the read fails', async () => {
    vi.mocked(uiStateGet).mockRejectedValue(new Error('boom'));
    const store = freshStore();
    await store.restore();
    expect(store.isRestoring).toBe(false);
  });

  it('refuses to open or duplicate tabs while the session is being read, so none is overwritten', async () => {
    let finish: (view: UiStateView) => void = () => undefined;
    vi.mocked(uiStateGet).mockReturnValue(
      new Promise<UiStateView>((done) => (finish = done)),
    );
    const store = freshStore();
    const pending = store.restore();
    expect(store.open('x')).toBeNull();
    expect(store.tabs).toHaveLength(0);
    finish(sessionView({ tabs: [savedTab('a')] }));
    await pending;
    expect(store.duplicate('id-a')).not.toBeNull();
    expect(store.open('x')).not.toBeNull();
  });
});

describe('restore retry after a failed read', () => {
  const folderView = {
    mode: 'details' as const,
    columns: ['size' as const],
    sort: 'size' as const,
    sort_direction: 'desc' as const,
    updated_ms: 9,
  };

  it('reads the session again on the next save and then persists', async () => {
    vi.mocked(uiStateGet)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(sessionView({ tabs: [savedTab('a')] }));
    const store = freshStore();
    await store.restore();
    store.open('b');
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(uiStateGet).toHaveBeenCalledTimes(2);
    expect(paths(store)).toEqual(['a']);
    expect(uiStateSet).toHaveBeenCalledTimes(1);
    expect(store.notice).toBeNull();
  });

  it('keeps telling that nothing is saved when the tab limit notice would replace it', async () => {
    vi.mocked(uiStateGet).mockRejectedValue(new Error('boom'));
    const store = freshStore();
    await store.restore();
    for (let count = 1; count < MAX_TABS; count += 1) {
      store.open(`p${count}`);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(store.open('extra')).toBeNull();
    expect(store.notice).toBe(RESTORE_FAILED_NOTICE);
  });

  it('retries once per save, not once per change while a read is running', async () => {
    vi.mocked(uiStateGet).mockRejectedValue(new Error('boom'));
    const store = freshStore();
    await store.restore();
    store.setView('x', folderView);
    store.setView('y', folderView);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(uiStateGet).toHaveBeenCalledTimes(2);
    store.setView('z', folderView);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(uiStateGet).toHaveBeenCalledTimes(3);
    expect(uiStateSet).not.toHaveBeenCalled();
  });

  it('does not retry after a successful restore', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    store.setView('x', folderView);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(uiStateGet).toHaveBeenCalledTimes(1);
  });
});

describe('persistence', () => {
  it('does not write right after restoring a session', async () => {
    await restoredStore({ tabs: [savedTab('a'), savedTab('gone', false)] });
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(uiStateSet).not.toHaveBeenCalled();
  });

  it('flushWithinLimit stops waiting for a write that never answers', async () => {
    vi.mocked(uiStateSet).mockReturnValue(new Promise(() => undefined));
    const store = await restoredStore({ tabs: [savedTab('a')] });
    store.open('b');
    let isDone = false;
    void store.flushWithinLimit().then(() => (isDone = true));
    await vi.advanceTimersByTimeAsync(SAVE_SETTLE_TIMEOUT_MS - 1);
    expect(isDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(isDone).toBe(true);
  });

  it('coalesces a burst of changes into one delayed write', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    store.open('b');
    store.open('c');
    store.move(store.activeId as string, 0);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS - 1);
    expect(uiStateSet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(uiStateSet).toHaveBeenCalledTimes(1);
  });

  it('writes plain tabs, the active tab and the restored favorites and views', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    store.open('b');
    await store.flush();
    const sent = vi.mocked(uiStateSet).mock.calls[0][0];
    expect(sent.version).toBe(1);
    expect(sent.tabs.map((tab) => tab.path)).toEqual(['a', 'b']);
    expect(sent.tabs[0]).not.toHaveProperty('exists');
    expect(sent.active_tab).toBe(store.activeId);
    expect(sent.favorites).toEqual([{ path: 'fav', name: 'Fav' }]);
    expect(sent.views[VIEW_KEY]).not.toHaveProperty('exists');
    expect(sent.views[VIEW_KEY].updated_ms).toBe(7);
  });

  it('refreshes favorites and views from the answer of a successful save', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    const newer = sessionView({
      favorites: [{ path: 'other', name: 'Other', exists: true }],
      views: {},
    });
    vi.mocked(uiStateSet).mockResolvedValueOnce(newer);
    store.open('b');
    await store.flush();
    store.open('c');
    await store.flush();
    const second = vi.mocked(uiStateSet).mock.calls[1][0];
    expect(second.favorites).toEqual([{ path: 'other', name: 'Other' }]);
    expect(second.views).toEqual({});
  });

  it('keeps the previous favorites and views when a save fails', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    vi.mocked(uiStateSet).mockRejectedValueOnce(new Error('disk'));
    store.open('b');
    await store.flush();
    await store.flush();
    const retried = vi.mocked(uiStateSet).mock.calls[1][0];
    expect(retried.favorites).toEqual([{ path: 'fav', name: 'Fav' }]);
  });

  it('flush writes pending changes immediately and only once', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    store.open('b');
    await store.flush();
    await store.flush();
    expect(uiStateSet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(uiStateSet).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing pending writes nothing', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    await store.flush();
    expect(uiStateSet).not.toHaveBeenCalled();
  });

  it('serializes overlapping writes so the last state wins', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    const order: number[] = [];
    let release: () => void = () => undefined;
    vi.mocked(uiStateSet).mockImplementationOnce(async (state) => {
      order.push(state.tabs.length);
      await new Promise<void>((done) => (release = done));
      return sessionView();
    });
    vi.mocked(uiStateSet).mockImplementation(async (state) => {
      order.push(state.tabs.length);
      return sessionView();
    });
    store.open('b');
    const first = store.flush();
    await vi.advanceTimersByTimeAsync(0);
    store.open('c');
    const second = store.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([2]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual([2, 3]);
  });

  it('reports a failing uiStateSet and retries on the next flush', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    vi.mocked(uiStateSet).mockRejectedValueOnce(new Error('disk'));
    store.open('b');
    await store.flush();
    expect(store.notice).toBe(SAVE_FAILED_NOTICE);
    await store.flush();
    expect(uiStateSet).toHaveBeenCalledTimes(2);
    expect(store.notice).toBeNull();
  });

  it('does not erase an unrelated notice after a successful write', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a'), savedTab('gone', false)],
    });
    store.open('b');
    await store.flush();
    expect(store.notice).toBe(omittedNotice(1));
  });
});

describe('favorites', () => {
  const stored = (path: string, exists = true) => ({
    path,
    name: path.toUpperCase(),
    exists,
  });
  const names = (store: ReturnType<typeof freshStore>) =>
    store.favorites.map((item) => item.path);

  it('refuses a duplicate that only differs by case and writes nothing', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a')],
      favorites: [stored('docs')],
    });
    expect(store.addFavorite('DOCS/')).toBe(false);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(names(store)).toEqual(['docs']);
    expect(uiStateSet).not.toHaveBeenCalled();
  });

  it('stops at the limit with a notice and keeps the existing favorites', async () => {
    const full = Array.from({ length: MAX_FAVORITES }, (_, n) =>
      stored(`f${n}`),
    );
    const store = await restoredStore({
      tabs: [savedTab('a')],
      favorites: full,
    });
    expect(store.addFavorite('una-mas')).toBe(false);
    expect(store.favorites).toHaveLength(MAX_FAVORITES);
    expect(store.notice).toBe(FAVORITES_LIMIT_NOTICE);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(uiStateSet).not.toHaveBeenCalled();
  });

  it('still lets the user remove one when the limit is reached', async () => {
    const full = Array.from({ length: MAX_FAVORITES }, (_, n) =>
      stored(`f${n}`),
    );
    const store = await restoredStore({
      tabs: [savedTab('a')],
      favorites: full,
    });
    store.removeFavorite('f0');
    expect(store.addFavorite('una-mas')).toBe(true);
  });

  it('ignores moves, renames and removals of a favorite that does not exist', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a')],
      favorites: [stored('a')],
    });
    store.moveFavorite('zzz', 0);
    store.renameFavorite('zzz', 'x');
    store.removeFavorite('zzz');
    expect(store.favorites).toEqual([stored('a')]);
  });

  it('does not rename to a blank name', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a')],
      favorites: [stored('a')],
    });
    store.renameFavorite('a', '   ');
    expect(store.favorites[0].name).toBe('A');
  });

  it('writes favorites together with the open tabs and the saved views, in one write', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    store.addFavorite('nueva', 'Mi carpeta');
    store.open('b');
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS);
    expect(uiStateSet).toHaveBeenCalledTimes(1);
    const sent = lastWrite();
    expect(sent.favorites).toEqual([
      { path: 'fav', name: 'Fav' },
      { path: 'nueva', name: 'Mi carpeta' },
    ]);
    expect(sent.tabs.map((tab) => tab.path)).toEqual(['a', 'b']);
    expect(sent.views[VIEW_KEY].updated_ms).toBe(7);
  });

  it('a tab change after a favorite change does not drop the favorite', async () => {
    const store = await restoredStore({ tabs: [savedTab('a')] });
    store.removeFavorite('fav');
    store.open('b');
    await store.flush();
    expect(lastWrite().favorites).toEqual([]);
  });

  it('keeps an unavailable favorite and writes it back without the flag', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a')],
      favorites: [stored('gone', false)],
    });
    expect(store.favorites[0].exists).toBe(false);
    store.open('b');
    await store.flush();
    expect(lastWrite().favorites).toEqual([{ path: 'gone', name: 'GONE' }]);
  });

  it('changes availability in memory without writing', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a')],
      favorites: [stored('a')],
    });
    store.markFavoriteAvailability('A', false);
    expect(store.favorites[0].exists).toBe(false);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(uiStateSet).not.toHaveBeenCalled();
  });

  it('keeps a favorite added while a write is in flight when the answer arrives', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a')],
      favorites: [stored('a')],
    });
    let answer: (value: UiStateView) => void = () => undefined;
    vi.mocked(uiStateSet).mockReturnValueOnce(
      new Promise<UiStateView>((resolve) => {
        answer = resolve;
      }),
    );
    store.open('b');
    const writing = store.flush();
    await vi.advanceTimersByTimeAsync(0);
    store.addFavorite('tarde');
    answer(sessionView({ favorites: [stored('a')] }));
    await writing;
    expect(names(store)).toEqual(['a', 'tarde']);
    await store.flush();
    expect(lastWrite().favorites.map((item) => item.path)).toEqual([
      'a',
      'tarde',
    ]);
  });

  it('refreshes availability from the answer when nothing newer is pending', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a')],
      favorites: [stored('a')],
    });
    vi.mocked(uiStateSet).mockResolvedValueOnce(
      sessionView({ favorites: [stored('a', false)] }),
    );
    store.addFavorite('b');
    await store.flush();
    expect(store.favorites).toEqual([stored('a', false)]);
  });

  it('keeps the local favorites and warns when the write fails', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a')],
      favorites: [stored('a')],
    });
    vi.mocked(uiStateSet).mockRejectedValueOnce(new Error('disk'));
    store.addFavorite('b');
    await store.flush();
    expect(names(store)).toEqual(['a', 'b']);
    expect(store.notice).toBe(SAVE_FAILED_NOTICE);
    await store.flush();
    expect(lastWrite().favorites.map((item) => item.path)).toEqual(['a', 'b']);
  });

  it('adds, renames, reorders and removes favorites and persists the result', async () => {
    const store = await restoredStore({
      tabs: [savedTab('a')],
      favorites: [],
    });
    store.addFavorite('a');
    store.addFavorite('b', 'Bravo');
    store.addFavorite('c');
    store.moveFavorite('c', 0);
    store.renameFavorite('a', 'Alfa');
    store.removeFavorite('b');
    await store.flush();
    expect(lastWrite().favorites).toEqual([
      { path: 'c', name: 'c' },
      { path: 'a', name: 'Alfa' },
    ]);
  });
});

describe('happy path', () => {
  it('opens, switches, reorders, duplicates and closes keeping a coherent session', async () => {
    const store = await restoredStore();
    const [, a, b] = [store.activeId as string, ...openMany(store, ['a', 'b'])];
    store.activate(a);
    store.move(b, 1);
    store.duplicate(a);
    expect(paths(store)).toEqual(['', 'b', 'a', 'a']);
    await store.closeToTheRight(a);
    expect(paths(store)).toEqual(['', 'b', 'a']);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS);
    const writes = vi.mocked(uiStateSet).mock.calls;
    expect(writes[writes.length - 1][0].active_tab).toBe(a);
  });
});

describe('folder views', () => {
  const view = {
    mode: 'details' as const,
    columns: ['size' as const],
    sort: 'size' as const,
    sort_direction: 'desc' as const,
    updated_ms: 9,
  };

  it('knows no view before the session was restored and does not write one', async () => {
    const store = freshStore();
    expect(store.viewOf('docs')).toBeNull();
    store.setView('docs', view);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS);
    expect(uiStateSet).not.toHaveBeenCalled();
    expect(store.viewOf('DOCS')).toEqual(view);
  });

  it('reads a saved view ignoring case and separator style', async () => {
    const store = await restoredStore();
    expect(store.viewOf('Docs/')).toMatchObject({ mode: 'grid' });
    expect(store.viewOf('otra')).toBeNull();
  });

  it('writes a new view together with the saved ones, favorites and tabs', async () => {
    const store = await restoredStore();
    store.open('a');
    store.setView('Nueva\Carpeta', view);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS);
    const sent = vi.mocked(uiStateSet).mock.calls[0][0];
    expect(Object.keys(sent.views).sort()).toEqual([VIEW_KEY, 'nueva\carpeta']);
    expect(sent.views[VIEW_KEY]).not.toHaveProperty('exists');
    expect(sent.favorites).toEqual([{ path: 'fav', name: 'Fav' }]);
    expect(sent.tabs.map((tab) => tab.path)).toEqual(['', 'a']);
  });

  it('keeps the newest local view when the server answer lacks it', async () => {
    const store = await restoredStore();
    store.setView('a', view);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS);
    store.open('b');
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS);
    const last = lastWrite();
    expect(last.views.a).toEqual(view);
  });
});
