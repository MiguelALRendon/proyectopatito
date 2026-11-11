import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../services/filesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/filesApi')>()),
  fsList: vi.fn(),
  wcStatusMap: vi.fn(),
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
}));
vi.mock('../services/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/tauri')>()),
  wcInfo: vi.fn(),
}));
vi.mock('../composables/useConfirm', () => ({ confirm: vi.fn() }));

import {
  fsList,
  wcStatusMap,
  uiStateGet,
  uiStateSet,
  type DirListing,
  type FileEntry,
  type UiStateView,
  type WcLocation,
} from '../services/filesApi';
import { wcInfo, type InfoEntry } from '../services/tauri';
import { DEFAULT_VIEW, navigationError, useExplorerStore } from './explorer';
import { PERSIST_DELAY_MS, useTabsStore } from './tabs';

function entry(name: string, extra: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    kind: 'file',
    size: 0,
    modified_ms: null,
    hidden: false,
    read_only: false,
    is_link: false,
    escapes_workspace: false,
    cloud_only: false,
    ...extra,
  };
}

const folder = (name: string, extra: Partial<FileEntry> = {}) =>
  entry(name, { kind: 'dir', ...extra });

function listing(
  path: string,
  entries: FileEntry[] = [],
  wc: WcLocation | null = null,
): DirListing {
  return { path, entries, truncated: false, wc };
}

function sessionView(overrides: Partial<UiStateView> = {}): UiStateView {
  return {
    version: 1,
    favorites: [{ path: 'fav', name: 'Fav', exists: true }],
    tabs: [],
    active_tab: null,
    views: {},
    ...overrides,
  };
}

const INFO = { revision: 7, relative_url: '^/trunk' } as InfoEntry;

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup(path = '') {
  setActivePinia(createPinia());
  const tabs = useTabsStore();
  const explorer = useExplorerStore();
  const tabId = tabs.open(path) as string;
  return { tabs, explorer, tabId };
}

async function restored(path: string, views: UiStateView['views'] = {}) {
  const saved = {
    id: 't1',
    kind: 'folder' as const,
    path,
    title: path,
    exists: true,
  };
  vi.mocked(uiStateGet).mockResolvedValue(
    sessionView({ tabs: [saved], active_tab: 't1', views }),
  );
  setActivePinia(createPinia());
  const tabs = useTabsStore();
  const explorer = useExplorerStore();
  await tabs.restore();
  vi.mocked(fsList).mockResolvedValue(listing(path));
  await explorer.attach('t1', path);
  return { tabs, explorer, id: 't1' };
}

async function opened(path = '', first = listing(path)) {
  vi.mocked(fsList).mockResolvedValueOnce(first);
  const context = setup(path);
  await context.explorer.attach(context.tabId, path);
  return context;
}

function lastWrite() {
  const calls = vi.mocked(uiStateSet).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.mocked(uiStateSet).mockResolvedValue(sessionView());
  vi.mocked(wcInfo).mockResolvedValue(INFO);
  vi.mocked(wcStatusMap).mockResolvedValue({
    entries: [],
    changed_folders: [],
    truncated: false,
    against_revision: null,
  });
});

afterEach(() => vi.useRealTimers());

describe('failed navigation keeps the previous location', () => {
  it('shows a clear error and keeps location, listing and history', async () => {
    const { explorer, tabId } = await opened(
      'a',
      listing('a', [folder('hijo')]),
    );
    vi.mocked(fsList).mockRejectedValueOnce({
      kind: 'io',
      message: 'no existe',
    });
    expect(await explorer.navigate(tabId, 'a\\hijo')).toBe('failed');
    const state = explorer.stateOf(tabId)!;
    expect(state.location).toBe('a');
    expect(state.listing?.entries.map((item) => item.name)).toEqual(['hijo']);
    expect(state.back).toEqual([]);
    expect(state.error?.message).toBe('No se pudo abrir «a\\hijo»: no existe');
    expect(state.isLoading).toBe(false);
  });

  it('does not touch the tab when the folder cannot be opened', async () => {
    const { explorer, tabs, tabId } = await opened('a');
    vi.mocked(fsList).mockRejectedValueOnce({ kind: 'io', message: 'x' });
    await explorer.navigate(tabId, 'otra');
    expect(tabs.tabs[0].path).toBe('a');
  });

  it('clears the error as soon as another navigation succeeds', async () => {
    const { explorer, tabId } = await opened('a');
    vi.mocked(fsList).mockRejectedValueOnce({ kind: 'io', message: 'x' });
    await explorer.navigate(tabId, 'rota');
    vi.mocked(fsList).mockResolvedValueOnce(listing('b'));
    await explorer.navigate(tabId, 'b');
    expect(explorer.stateOf(tabId)?.error).toBeNull();
  });

  it('names the workspace root by its shell name in the message', () => {
    expect(navigationError('', { kind: 'io', message: 'x' }).message).toBe(
      'No se pudo abrir «Mis archivos»: x',
    );
  });

  it('keeps the forward stack when going back fails', async () => {
    const { explorer, tabId } = await opened('a');
    vi.mocked(fsList).mockResolvedValueOnce(listing('b'));
    await explorer.navigate(tabId, 'b');
    vi.mocked(fsList).mockRejectedValueOnce({ kind: 'io', message: 'x' });
    expect(await explorer.goBack(tabId)).toBe(false);
    const state = explorer.stateOf(tabId)!;
    expect(state.back).toEqual(['a']);
    expect(state.forward).toEqual([]);
    expect(state.location).toBe('b');
  });

  it('keeps an attach failure visible and lets the user retry with refresh', async () => {
    setActivePinia(createPinia());
    const tabs = useTabsStore();
    const explorer = useExplorerStore();
    const id = tabs.open('rota') as string;
    vi.mocked(fsList).mockRejectedValueOnce({ kind: 'io', message: 'x' });
    await explorer.attach(id, 'rota');
    expect(explorer.stateOf(id)?.listing).toBeNull();
    expect(explorer.stateOf(id)?.location).toBe('rota');
    vi.mocked(fsList).mockResolvedValueOnce(listing('rota'));
    await explorer.reload(id);
    expect(explorer.stateOf(id)?.listing).not.toBeNull();
    expect(explorer.stateOf(id)?.error).toBeNull();
  });
});

describe('out-of-order loads', () => {
  it('ignores a slow answer that arrives after a newer navigation', async () => {
    const { explorer, tabId } = await opened('');
    const slow = deferred<DirListing>();
    vi.mocked(fsList).mockReturnValueOnce(slow.promise);
    const first = explorer.navigate(tabId, 'lenta');
    vi.mocked(fsList).mockResolvedValueOnce(listing('rapida'));
    await explorer.navigate(tabId, 'rapida');
    slow.resolve(listing('lenta'));
    expect(await first).toBe('superseded');
    expect(explorer.stateOf(tabId)?.location).toBe('rapida');
    expect(explorer.stateOf(tabId)?.back).toEqual(['']);
  });

  it('ignores a slow failure that arrives after a newer success', async () => {
    const { explorer, tabId } = await opened('');
    const slow = deferred<DirListing>();
    vi.mocked(fsList).mockReturnValueOnce(slow.promise);
    const first = explorer.navigate(tabId, 'lenta');
    vi.mocked(fsList).mockResolvedValueOnce(listing('b'));
    await explorer.navigate(tabId, 'b');
    slow.reject({ kind: 'io', message: 'tarde' });
    await first;
    expect(explorer.stateOf(tabId)?.error).toBeNull();
    expect(explorer.stateOf(tabId)?.isLoading).toBe(false);
  });

  it('does nothing for a tab that has no explorer state', async () => {
    const { explorer } = setup();
    expect(await explorer.navigate('fantasma', 'a')).toBe('superseded');
    expect(await explorer.goBack('fantasma')).toBe(false);
    expect(await explorer.goUp('fantasma')).toBe(false);
    expect(await explorer.reload('fantasma')).toBe(false);
    expect(fsList).not.toHaveBeenCalled();
  });
});

describe('history', () => {
  it('goes back and forward through the visited folders', async () => {
    const { explorer, tabId } = await opened('a');
    vi.mocked(fsList).mockResolvedValueOnce(listing('b'));
    await explorer.navigate(tabId, 'b');
    vi.mocked(fsList).mockResolvedValueOnce(listing('c'));
    await explorer.navigate(tabId, 'c');
    vi.mocked(fsList).mockResolvedValueOnce(listing('b'));
    await explorer.goBack(tabId);
    const state = explorer.stateOf(tabId)!;
    expect([state.location, state.back, state.forward]).toEqual([
      'b',
      ['a'],
      ['c'],
    ]);
    vi.mocked(fsList).mockResolvedValueOnce(listing('c'));
    await explorer.goForward(tabId);
    expect(state.location).toBe('c');
    expect(state.forward).toEqual([]);
  });

  it('drops the forward stack when navigating somewhere new', async () => {
    const { explorer, tabId } = await opened('a');
    vi.mocked(fsList).mockResolvedValueOnce(listing('b'));
    await explorer.navigate(tabId, 'b');
    vi.mocked(fsList).mockResolvedValueOnce(listing('a'));
    await explorer.goBack(tabId);
    vi.mocked(fsList).mockResolvedValueOnce(listing('z'));
    await explorer.navigate(tabId, 'z');
    expect(explorer.stateOf(tabId)?.forward).toEqual([]);
  });

  it('does not push the current folder onto the history when re-entering it', async () => {
    const { explorer, tabId } = await opened('a');
    vi.mocked(fsList).mockResolvedValueOnce(listing('a'));
    await explorer.navigate(tabId, 'A');
    expect(explorer.stateOf(tabId)?.back).toEqual([]);
  });

  it('has nothing to go back or forward to at the start', async () => {
    const { explorer, tabId } = await opened('a');
    expect(await explorer.goBack(tabId)).toBe(false);
    expect(await explorer.goForward(tabId)).toBe(false);
    expect(fsList).toHaveBeenCalledTimes(1);
  });

  it('goes up one level and never above the workspace root', async () => {
    const { explorer, tabId } = await opened('a\\b', listing('a\\b'));
    vi.mocked(fsList).mockResolvedValueOnce(listing('a'));
    expect(await explorer.goUp(tabId)).toBe(true);
    expect(fsList).toHaveBeenLastCalledWith('a');
    vi.mocked(fsList).mockResolvedValueOnce(listing(''));
    await explorer.goUp(tabId);
    expect(await explorer.goUp(tabId)).toBe(false);
    expect(fsList).toHaveBeenCalledTimes(3);
  });
});

describe('selection, filter and hidden entries', () => {
  const entries = [
    entry('a.txt'),
    entry('b.txt'),
    entry('.oculto', { hidden: true }),
  ];

  it('hides hidden entries by default and shows them on request', async () => {
    const { explorer, tabId } = await opened('', listing('', entries));
    expect(explorer.visibleOf(tabId).map((item) => item.name)).toEqual([
      'a.txt',
      'b.txt',
    ]);
    explorer.toggleHidden(tabId);
    expect(explorer.visibleOf(tabId)).toHaveLength(3);
  });

  it('drops a selected entry that becomes hidden again', async () => {
    const { explorer, tabId } = await opened('', listing('', entries));
    explorer.toggleHidden(tabId);
    explorer.select(tabId, ['a.txt', '.oculto']);
    explorer.toggleHidden(tabId);
    expect(explorer.stateOf(tabId)?.selection).toEqual(['a.txt']);
  });

  it('drops the selection of entries the filter hides', async () => {
    const { explorer, tabId } = await opened('', listing('', entries));
    explorer.select(tabId, ['a.txt', 'b.txt']);
    explorer.setFilter(tabId, 'b.');
    expect(explorer.stateOf(tabId)?.selection).toEqual(['b.txt']);
    expect(explorer.visibleOf(tabId).map((item) => item.name)).toEqual([
      'b.txt',
    ]);
  });

  it('clears selection and filter on entering another folder but not on reload', async () => {
    const { explorer, tabId } = await opened('', listing('', entries));
    explorer.select(tabId, ['a.txt']);
    explorer.setFilter(tabId, 'a');
    vi.mocked(fsList).mockResolvedValueOnce(listing('', entries));
    await explorer.reload(tabId);
    expect(explorer.stateOf(tabId)?.selection).toEqual(['a.txt']);
    expect(explorer.stateOf(tabId)?.filter).toBe('a');
    vi.mocked(fsList).mockResolvedValueOnce(listing('x'));
    await explorer.navigate(tabId, 'x');
    expect(explorer.stateOf(tabId)?.selection).toEqual([]);
    expect(explorer.stateOf(tabId)?.filter).toBe('');
  });

  it('forgets selected entries that disappeared after a reload', async () => {
    const { explorer, tabId } = await opened('', listing('', entries));
    explorer.select(tabId, ['a.txt', 'b.txt']);
    vi.mocked(fsList).mockResolvedValueOnce(listing('', [entry('b.txt')]));
    await explorer.reload(tabId);
    expect(explorer.stateOf(tabId)?.selection).toEqual(['b.txt']);
  });

  it('ignores selection changes for a tab without state', () => {
    const { explorer } = setup();
    expect(() => explorer.select('fantasma', ['a'])).not.toThrow();
    expect(() => explorer.setFilter('fantasma', 'a')).not.toThrow();
    expect(explorer.visibleOf('fantasma')).toEqual([]);
  });
});

describe('view per folder', () => {
  it('starts with the default view and persists nothing until the user changes it', async () => {
    const { explorer, tabId } = await opened('a');
    expect(explorer.stateOf(tabId)?.view).toEqual(DEFAULT_VIEW);
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS);
    expect(uiStateSet).not.toHaveBeenCalled();
  });

  it('toggles the sort direction when sorting twice by the same key', async () => {
    const { explorer, tabId } = await opened('a');
    explorer.sortBy(tabId, 'size');
    expect(explorer.stateOf(tabId)?.view).toMatchObject({
      sort: 'size',
      sort_direction: 'asc',
    });
    explorer.sortBy(tabId, 'size');
    expect(explorer.stateOf(tabId)?.view.sort_direction).toBe('desc');
    explorer.sortBy(tabId, 'modified');
    expect(explorer.stateOf(tabId)?.view).toMatchObject({
      sort: 'modified',
      sort_direction: 'asc',
    });
  });

  it('keeps the columns in canonical order when toggling them', async () => {
    const { explorer, tabId } = await opened('a');
    explorer.toggleColumn(tabId, 'size');
    expect(explorer.stateOf(tabId)?.view.columns).toEqual(['type', 'modified']);
    explorer.toggleColumn(tabId, 'size');
    expect(explorer.stateOf(tabId)?.view.columns).toEqual([
      'type',
      'size',
      'modified',
    ]);
  });

  it('writes the view with the rest of the ui state, keeping favorites and tabs', async () => {
    const { explorer, id } = await restored('a');
    explorer.updateView(id, { mode: 'details' });
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS);
    expect(uiStateSet).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(uiStateSet).mock.calls[0][0];
    expect(sent.favorites).toEqual([{ path: 'fav', name: 'Fav' }]);
    expect(sent.views.a).toMatchObject({ mode: 'details' });
    expect(sent.tabs.map((tab) => tab.path)).toEqual(['a']);
  });

  it('merges view changes and tab navigation into one write', async () => {
    const { explorer, id } = await restored('a');
    explorer.updateView(id, { mode: 'list' });
    vi.mocked(fsList).mockResolvedValueOnce(listing('a\b'));
    await explorer.navigate(id, 'a\b');
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS);
    expect(uiStateSet).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(uiStateSet).mock.calls[0][0];
    expect(sent.tabs.map((tab) => tab.path)).toEqual(['a\b']);
    expect(sent.views.a).toMatchObject({ mode: 'list' });
  });

  it('does not lose a view changed while a previous write is in flight', async () => {
    const { explorer, id } = await restored('a');
    const slow = deferred<UiStateView>();
    vi.mocked(uiStateSet).mockReturnValueOnce(slow.promise);
    explorer.updateView(id, { mode: 'list' });
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS);
    explorer.updateView(id, { mode: 'details' });
    slow.resolve(sessionView({ views: {} }));
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS);
    const last = lastWrite();
    expect(last.views.a).toMatchObject({ mode: 'details' });
  });

  it('keeps the view of one folder apart from another and restores it on return', async () => {
    const { explorer, tabId } = await opened('a');
    explorer.updateView(tabId, { mode: 'details' });
    vi.mocked(fsList).mockResolvedValueOnce(listing('b'));
    await explorer.navigate(tabId, 'b');
    expect(explorer.stateOf(tabId)?.view).toEqual(DEFAULT_VIEW);
    vi.mocked(fsList).mockResolvedValueOnce(listing('A'));
    await explorer.navigate(tabId, 'A');
    expect(explorer.stateOf(tabId)?.view.mode).toBe('details');
  });

  it('applies the view saved in a previous run, matching the folder ignoring case', async () => {
    const saved = {
      mode: 'list' as const,
      columns: ['size' as const],
      sort: 'size' as const,
      sort_direction: 'desc' as const,
      updated_ms: 5,
      exists: true,
    };
    const { explorer, id } = await restored('A', { a: saved });
    expect(explorer.stateOf(id)?.view).toMatchObject({
      mode: 'list',
      sort: 'size',
      sort_direction: 'desc',
    });
  });
});

describe('opening entries', () => {
  const content = listing('a', [
    folder('docs'),
    entry('notas.md'),
    folder('enlace', { is_link: true, escapes_workspace: true }),
  ]);

  it('enters a folder inside the same tab and updates the tab path', async () => {
    const { explorer, tabs, tabId } = await opened('a', content);
    vi.mocked(fsList).mockResolvedValueOnce(listing('a\\docs'));
    await explorer.openEntry(tabId, 'docs');
    expect(tabs.tabs).toHaveLength(1);
    expect(tabs.tabs[0]).toMatchObject({ path: 'a\\docs', title: 'docs' });
    expect(explorer.stateOf(tabId)?.back).toEqual(['a']);
  });

  it('opens a folder in a new tab without duplicating an existing one', async () => {
    const { explorer, tabs, tabId } = await opened('a', content);
    await explorer.openEntry(tabId, 'docs', true);
    await explorer.openEntry(tabId, 'docs', true);
    await explorer.openEntry(tabId, 'docs', true);
    expect(tabs.tabs.map((tab) => tab.path)).toEqual(['a', 'a\\docs']);
    expect(fsList).toHaveBeenCalledTimes(1);
  });

  it('opens a file as a document tab, once', async () => {
    const { explorer, tabs, tabId } = await opened('a', content);
    await explorer.openEntry(tabId, 'notas.md');
    await explorer.openEntry(tabId, 'notas.md', true);
    expect(tabs.tabs.filter((tab) => tab.kind === 'document')).toHaveLength(1);
    expect(tabs.activeTab).toMatchObject({
      kind: 'document',
      path: 'a\\notas.md',
    });
    expect(explorer.stateOf(tabId)?.location).toBe('a');
  });

  it('never opens a link that escapes the workspace or an unknown name', async () => {
    const { explorer, tabs, tabId } = await opened('a', content);
    await explorer.openEntry(tabId, 'enlace');
    await explorer.openEntry(tabId, 'enlace', true);
    await explorer.openEntry(tabId, 'no-existe');
    expect(tabs.tabs).toHaveLength(1);
    expect(fsList).toHaveBeenCalledTimes(1);
  });

  it('opens a breadcrumb in place or in a new tab', async () => {
    const { explorer, tabs, tabId } = await opened('a\\b', listing('a\\b'));
    await explorer.openPath(tabId, 'a', true);
    expect(tabs.tabs.map((tab) => tab.path)).toEqual(['a\\b', 'a']);
    vi.mocked(fsList).mockResolvedValueOnce(listing('a'));
    await explorer.openPath(tabId, 'a', false);
    expect(explorer.stateOf(tabId)?.location).toBe('a');
  });
});

describe('working copy header', () => {
  const wc = { root: 'wc', is_root: true };

  it('reads wc_info of the copy root once while moving inside the copy', async () => {
    const { explorer, tabId } = await opened('wc', listing('wc', [], wc));
    await vi.waitFor(() =>
      expect(explorer.stateOf(tabId)?.header?.info).toEqual(INFO),
    );
    vi.mocked(fsList).mockResolvedValueOnce(
      listing('wc\\sub', [], { root: 'wc', is_root: false }),
    );
    await explorer.navigate(tabId, 'wc\\sub');
    expect(wcInfo).toHaveBeenCalledTimes(1);
    expect(wcInfo).toHaveBeenCalledWith('wc');
  });

  it('has no header outside a copy and drops it when leaving one', async () => {
    const { explorer, tabId } = await opened('wc', listing('wc', [], wc));
    await vi.waitFor(() =>
      expect(explorer.stateOf(tabId)?.header).not.toBeNull(),
    );
    vi.mocked(fsList).mockResolvedValueOnce(listing('local'));
    await explorer.navigate(tabId, 'local');
    expect(explorer.stateOf(tabId)?.header).toBeNull();
  });

  it('keeps the listing and records the error of an old-format copy', async () => {
    vi.mocked(wcInfo).mockRejectedValue({
      kind: 'working_copy_too_old',
      message: 'formato antiguo',
    });
    const { explorer, tabId } = await opened(
      'vieja',
      listing('vieja', [entry('a.txt')], { root: 'vieja', is_root: true }),
    );
    await vi.waitFor(() =>
      expect(explorer.stateOf(tabId)?.header?.error?.kind).toBe(
        'working_copy_too_old',
      ),
    );
    const state = explorer.stateOf(tabId)!;
    expect(state.header?.info).toBeNull();
    expect(state.listing?.entries).toHaveLength(1);
    expect(state.error).toBeNull();
  });

  it('refreshes the header on reload and keeps the old data while it loads', async () => {
    const { explorer, tabId } = await opened('wc', listing('wc', [], wc));
    await vi.waitFor(() =>
      expect(explorer.stateOf(tabId)?.header?.info).toEqual(INFO),
    );
    const slow = deferred<InfoEntry>();
    vi.mocked(wcInfo).mockReturnValueOnce(slow.promise);
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc', [], wc));
    await explorer.reload(tabId);
    expect(explorer.stateOf(tabId)?.header).toMatchObject({
      isLoading: true,
      info: INFO,
    });
    slow.resolve({ ...INFO, revision: 8 });
    await vi.waitFor(() =>
      expect(explorer.stateOf(tabId)?.header?.info?.revision).toBe(8),
    );
  });

  it('ignores a header answer for a copy the user already left', async () => {
    const slow = deferred<InfoEntry>();
    vi.mocked(wcInfo).mockReturnValueOnce(slow.promise);
    const { explorer, tabId } = await opened('wc', listing('wc', [], wc));
    vi.mocked(fsList).mockResolvedValueOnce(listing('local'));
    await explorer.navigate(tabId, 'local');
    slow.resolve(INFO);
    await Promise.resolve();
    await Promise.resolve();
    expect(explorer.stateOf(tabId)?.header).toBeNull();
  });
});

describe('tab lifecycle', () => {
  it('attaches once per tab and survives a second attach', async () => {
    const { explorer, tabId } = await opened('a');
    await explorer.attach(tabId, 'a');
    expect(fsList).toHaveBeenCalledTimes(1);
  });

  it('forgets the state of a closed tab and keeps the others', async () => {
    const { explorer, tabs, tabId } = await opened('a');
    vi.mocked(fsList).mockResolvedValue(listing('b'));
    const other = tabs.open('b') as string;
    await explorer.attach(other, 'b');
    await tabs.close(tabId);
    await vi.waitFor(() => expect(explorer.stateOf(tabId)).toBeNull());
    expect(explorer.stateOf(other)).not.toBeNull();
  });

  it('exposes the working copy of the active tab', async () => {
    const wc = { root: 'wc', is_root: true };
    const { explorer, tabs } = await opened('wc', listing('wc', [], wc));
    expect(explorer.activeWc).toEqual(wc);
    tabs.open('local');
    expect(explorer.activeWc).toBeNull();
  });

  it('gives a duplicated tab its own history', async () => {
    const { explorer, tabs, tabId } = await opened('a');
    const copy = tabs.duplicate(tabId) as string;
    vi.mocked(fsList).mockResolvedValue(listing('a'));
    await explorer.attach(copy, 'a');
    vi.mocked(fsList).mockResolvedValueOnce(listing('b'));
    await explorer.navigate(copy, 'b');
    expect(explorer.stateOf(copy)?.back).toEqual(['a']);
    expect(explorer.stateOf(tabId)?.back).toEqual([]);
  });
});

describe('listing a folder', () => {
  it('shows the entries of the active folder and the truncated flag', async () => {
    const full = { ...listing('a', [entry('x')]), truncated: true };
    const { explorer, tabId } = await opened('a', full);
    expect(explorer.stateOf(tabId)?.listing?.truncated).toBe(true);
    expect(explorer.visibleOf(tabId).map((item) => item.name)).toEqual(['x']);
  });
});
