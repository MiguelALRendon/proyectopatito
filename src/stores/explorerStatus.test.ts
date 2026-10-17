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
  type DirListing,
  type FileEntry,
  type WcLocation,
  type WcStatusMap,
} from '../services/filesApi';
import { wcInfo, type InfoEntry, type StatusEntry } from '../services/tauri';
import { useExplorerStore } from './explorer';
import { useTabsStore } from './tabs';

const COPY: WcLocation = { root: 'wc', is_root: true };
const OTHER_COPY: WcLocation = { root: 'otra', is_root: true };
const PASSWORD = 'secreto-que-no-se-guarda';

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

function listing(
  path: string,
  entries: FileEntry[] = [],
  wc: WcLocation | null = null,
): DirListing {
  return { path, entries, truncated: false, wc };
}

function status(path: string, extra: Partial<StatusEntry> = {}): StatusEntry {
  return {
    path,
    item: 'modified',
    props: 'none',
    revision: 1,
    remote_item: null,
    remote_props: null,
    wc_locked: false,
    tree_conflicted: false,
    copied: false,
    switched: false,
    lock: null,
    ...extra,
  };
}

function statusMap(
  entries: StatusEntry[],
  extra: Partial<WcStatusMap> = {},
): WcStatusMap {
  return {
    entries,
    changed_folders: [],
    truncated: false,
    against_revision: null,
    ...extra,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function opened(path: string, first: DirListing) {
  vi.mocked(fsList).mockResolvedValueOnce(first);
  setActivePinia(createPinia());
  const tabs = useTabsStore();
  const explorer = useExplorerStore();
  const tabId = tabs.open(path) as string;
  await explorer.attach(tabId, path);
  await vi.advanceTimersByTimeAsync(0);
  return { tabs, explorer, tabId };
}

const keysOf = (explorer: ReturnType<typeof useExplorerStore>, id: string) =>
  [...(explorer.stateOf(id)?.status?.index?.entries.keys() ?? [])].sort();

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.mocked(wcInfo).mockResolvedValue({ revision: 1 } as InfoEntry);
  vi.mocked(wcStatusMap).mockResolvedValue(statusMap([]));
});

afterEach(() => vi.useRealTimers());

describe('the overlay is never requested outside a working copy', () => {
  it('does not call the status map for a plain folder', async () => {
    const { explorer, tabId } = await opened('local', listing('local'));
    expect(wcStatusMap).not.toHaveBeenCalled();
    expect(explorer.stateOf(tabId)?.status).toBeNull();
  });

  it('does not call it either when a refresh happens in a plain folder', async () => {
    const { explorer, tabId } = await opened('local', listing('local'));
    vi.mocked(fsList).mockResolvedValueOnce(listing('local'));
    await explorer.reload(tabId);
    await explorer.refreshStatus();
    await explorer.checkServer(tabId);
    expect(wcStatusMap).not.toHaveBeenCalled();
  });

  it('clears the overlay and ignores a late answer after leaving the copy', async () => {
    const slow = deferred<WcStatusMap>();
    vi.mocked(wcStatusMap).mockReturnValueOnce(slow.promise);
    const { explorer, tabId } = await opened(
      'wc',
      listing('wc', [entry('hijo', { kind: 'dir' })], COPY),
    );
    vi.mocked(fsList).mockResolvedValueOnce(listing('fuera'));
    await explorer.navigate(tabId, 'fuera');
    slow.resolve(statusMap([status('wc\\a.txt')]));
    await vi.advanceTimersByTimeAsync(0);
    expect(explorer.stateOf(tabId)?.status).toBeNull();
  });
});

describe('asynchronous overlay', () => {
  it('shows the listing first and marks the overlay as loading until the answer', async () => {
    const slow = deferred<WcStatusMap>();
    vi.mocked(wcStatusMap).mockReturnValueOnce(slow.promise);
    const { explorer, tabId } = await opened(
      'wc',
      listing('wc', [entry('a.txt')], COPY),
    );
    const state = explorer.stateOf(tabId)!;
    expect(state.listing?.entries).toHaveLength(1);
    expect(state.isLoading).toBe(false);
    expect(state.status).toMatchObject({ isLoading: true, index: null });
    slow.resolve(statusMap([status('wc\\a.txt')]));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.status).toMatchObject({ isLoading: false, error: null });
    expect(keysOf(explorer, tabId)).toEqual(['wc\\a.txt']);
  });

  it('asks without refreshing the first time and refreshing on reload', async () => {
    const { explorer, tabId } = await opened('wc', listing('wc', [], COPY));
    expect(vi.mocked(wcStatusMap).mock.calls[0][0]).toEqual({
      wc_root: 'wc',
      remote: false,
      refresh: false,
      username: null,
      password: null,
    });
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc', [], COPY));
    await explorer.reload(tabId);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(wcStatusMap).mock.calls[1][0]).toMatchObject({
      refresh: true,
      remote: false,
    });
  });

  it('discards an answer that arrives after a newer request', async () => {
    const slow = deferred<WcStatusMap>();
    vi.mocked(wcStatusMap).mockReturnValueOnce(slow.promise);
    const { explorer, tabId } = await opened('wc', listing('wc', [], COPY));
    vi.mocked(wcStatusMap).mockResolvedValueOnce(
      statusMap([status('wc\\nuevo.txt')]),
    );
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc', [], COPY));
    await explorer.reload(tabId);
    await vi.advanceTimersByTimeAsync(0);
    slow.resolve(statusMap([status('wc\\viejo.txt')]));
    await vi.advanceTimersByTimeAsync(0);
    expect(keysOf(explorer, tabId)).toEqual(['wc\\nuevo.txt']);
  });

  it('does not ask again while moving inside the same copy, but does for another copy', async () => {
    const { explorer, tabId } = await opened(
      'wc',
      listing('wc', [entry('sub', { kind: 'dir' })], COPY),
    );
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc\\sub', [], COPY));
    await explorer.navigate(tabId, 'wc\\sub');
    expect(wcStatusMap).toHaveBeenCalledTimes(1);
    vi.mocked(fsList).mockResolvedValueOnce(listing('otra', [], OTHER_COPY));
    await explorer.navigate(tabId, 'otra');
    expect(wcStatusMap).toHaveBeenCalledTimes(2);
    expect(vi.mocked(wcStatusMap).mock.calls[1][0].wc_root).toBe('otra');
  });
});

describe('when the status cannot be calculated', () => {
  it('keeps the listing and records the error', async () => {
    vi.mocked(wcStatusMap).mockRejectedValueOnce({
      kind: 'timed_out',
      message: 'tardó demasiado',
    });
    const { explorer, tabId } = await opened(
      'wc',
      listing('wc', [entry('a.txt')], COPY),
    );
    const state = explorer.stateOf(tabId)!;
    expect(state.listing?.entries).toHaveLength(1);
    expect(state.status).toMatchObject({
      isLoading: false,
      index: null,
      error: { kind: 'timed_out' },
    });
  });

  it('drops the badges of a previous answer instead of showing stale ones', async () => {
    vi.mocked(wcStatusMap).mockResolvedValueOnce(
      statusMap([status('wc\\a.txt')]),
    );
    const { explorer, tabId } = await opened('wc', listing('wc', [], COPY));
    expect(keysOf(explorer, tabId)).toHaveLength(1);
    vi.mocked(wcStatusMap).mockRejectedValueOnce({
      kind: 'svn_failed',
      message: 'boom',
    });
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc', [], COPY));
    await explorer.reload(tabId);
    await vi.advanceTimersByTimeAsync(0);
    expect(explorer.stateOf(tabId)?.status?.index).toBeNull();
    expect(explorer.stateOf(tabId)?.status?.error?.kind).toBe('svn_failed');
  });

  it('reports a truncated answer instead of hiding it', async () => {
    vi.mocked(wcStatusMap).mockResolvedValueOnce(
      statusMap([status('wc\\a.txt')], { truncated: true }),
    );
    const { explorer, tabId } = await opened('wc', listing('wc', [], COPY));
    expect(explorer.stateOf(tabId)?.status?.truncated).toBe(true);
  });
});

describe('checking the server', () => {
  it('asks with the remote flag, refreshing and with the credentials, once', async () => {
    const { explorer, tabId } = await opened('wc', listing('wc', [], COPY));
    await explorer.checkServer(tabId, { username: 'ana', password: PASSWORD });
    expect(vi.mocked(wcStatusMap).mock.calls[1][0]).toEqual({
      wc_root: 'wc',
      remote: true,
      refresh: true,
      username: 'ana',
      password: PASSWORD,
    });
  });

  it('never keeps the password in the state', async () => {
    const { explorer, tabId } = await opened('wc', listing('wc', [], COPY));
    await explorer.checkServer(tabId, { username: 'ana', password: PASSWORD });
    expect(JSON.stringify(explorer.stateOf(tabId))).not.toContain(PASSWORD);
  });

  it('marks the check in progress and the overlay as compared with the server', async () => {
    const { explorer, tabId } = await opened('wc', listing('wc', [], COPY));
    const slow = deferred<WcStatusMap>();
    vi.mocked(wcStatusMap).mockReturnValueOnce(slow.promise);
    const checking = explorer.checkServer(tabId);
    expect(explorer.stateOf(tabId)?.status).toMatchObject({
      isLoading: true,
      isCheckingServer: true,
      isRemote: false,
    });
    slow.resolve(statusMap([], { against_revision: 9 }));
    await checking;
    expect(explorer.stateOf(tabId)?.status).toMatchObject({
      isLoading: false,
      isCheckingServer: false,
      isRemote: true,
      againstRevision: 9,
    });
  });

  it('keeps the local badges when the server asks for credentials', async () => {
    vi.mocked(wcStatusMap).mockResolvedValueOnce(
      statusMap([status('wc\\a.txt')]),
    );
    const { explorer, tabId } = await opened('wc', listing('wc', [], COPY));
    vi.mocked(wcStatusMap).mockRejectedValueOnce({
      kind: 'auth_required',
      message: 'hace falta autenticarse',
    });
    await explorer.checkServer(tabId);
    const overlay = explorer.stateOf(tabId)?.status;
    expect(overlay?.error?.kind).toBe('auth_required');
    expect(overlay?.isRemote).toBe(false);
    expect(overlay?.isCheckingServer).toBe(false);
    expect(keysOf(explorer, tabId)).toEqual(['wc\\a.txt']);
  });

  it('a new attempt clears the previous error', async () => {
    const { explorer, tabId } = await opened('wc', listing('wc', [], COPY));
    vi.mocked(wcStatusMap).mockRejectedValueOnce({
      kind: 'auth_required',
      message: 'x',
    });
    await explorer.checkServer(tabId);
    await explorer.checkServer(tabId, { username: 'ana', password: PASSWORD });
    expect(explorer.stateOf(tabId)?.status?.error).toBeNull();
    expect(explorer.stateOf(tabId)?.status?.isRemote).toBe(true);
  });

  it('does nothing for a tab that does not exist', async () => {
    const { explorer } = await opened('wc', listing('wc', [], COPY));
    await explorer.checkServer('fantasma');
    expect(wcStatusMap).toHaveBeenCalledTimes(1);
  });

  it('a local refresh goes back to the local overlay', async () => {
    const { explorer, tabId } = await opened('wc', listing('wc', [], COPY));
    await explorer.checkServer(tabId);
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc', [], COPY));
    await explorer.reload(tabId);
    await vi.advanceTimersByTimeAsync(0);
    expect(explorer.stateOf(tabId)?.status?.isRemote).toBe(false);
  });
});

describe('invalidation', () => {
  async function twoTabs() {
    const { tabs, explorer, tabId } = await opened(
      'wc',
      listing('wc', [], COPY),
    );
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc\\b', [], COPY));
    const second = tabs.open('wc\\b') as string;
    await explorer.attach(second, 'wc\\b');
    await vi.advanceTimersByTimeAsync(0);
    return { tabs, explorer, first: tabId, second };
  }

  it('reloads the listing and the statuses of the active tab after a change', async () => {
    const { explorer, second } = await twoTabs();
    vi.mocked(fsList).mockClear();
    vi.mocked(wcStatusMap).mockClear();
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc\\b', [], COPY));
    await explorer.reloadAfterChange();
    await vi.advanceTimersByTimeAsync(0);
    expect(fsList).toHaveBeenCalledWith('wc\\b');
    expect(vi.mocked(wcStatusMap).mock.calls[0][0].refresh).toBe(true);
    expect(explorer.stateOf(second)?.isStale).toBe(false);
  });

  it('marks the other tabs stale and reloads them when they are shown again', async () => {
    const { explorer, first } = await twoTabs();
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc\\b', [], COPY));
    await explorer.reloadAfterChange();
    expect(explorer.stateOf(first)?.isStale).toBe(true);
    vi.mocked(fsList).mockClear();
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc', [], COPY));
    await explorer.attach(first, 'wc');
    expect(fsList).toHaveBeenCalledTimes(1);
    expect(explorer.stateOf(first)?.isStale).toBe(false);
  });

  it('does not reload a tab that is not stale when it is attached again', async () => {
    const { explorer, first } = await twoTabs();
    vi.mocked(fsList).mockClear();
    await explorer.attach(first, 'wc');
    expect(fsList).not.toHaveBeenCalled();
  });

  it('keeps the tab stale when its reload fails, to try again later', async () => {
    const { explorer, first } = await twoTabs();
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc\\b', [], COPY));
    await explorer.reloadAfterChange();
    vi.mocked(fsList).mockRejectedValueOnce({ kind: 'io', message: 'x' });
    await explorer.attach(first, 'wc');
    expect(explorer.stateOf(first)?.isStale).toBe(true);
  });

  it('refreshes only the statuses of every copy tab, leaving the listings alone', async () => {
    const { explorer, first, second } = await twoTabs();
    vi.mocked(fsList).mockClear();
    vi.mocked(wcStatusMap).mockClear();
    await explorer.refreshStatus();
    expect(fsList).not.toHaveBeenCalled();
    expect(wcStatusMap).toHaveBeenCalledTimes(2);
    vi.mocked(wcStatusMap).mock.calls.forEach(([request]) =>
      expect(request).toMatchObject({ refresh: true, remote: false }),
    );
    expect(explorer.stateOf(first)?.isStale).toBe(false);
    expect(explorer.stateOf(second)?.isStale).toBe(false);
  });

  it('skips the tabs that are not in a working copy when refreshing statuses', async () => {
    const { tabs, explorer } = await twoTabs();
    vi.mocked(fsList).mockResolvedValueOnce(listing('local'));
    const plain = tabs.open('local') as string;
    await explorer.attach(plain, 'local');
    vi.mocked(wcStatusMap).mockClear();
    await explorer.refreshStatus();
    expect(wcStatusMap).toHaveBeenCalledTimes(2);
    expect(explorer.stateOf(plain)?.status).toBeNull();
  });

  describe('with a document as the active tab', () => {
    async function withDocument() {
      const opened = await twoTabs();
      opened.tabs.open('wc\\a.txt', 'document');
      vi.mocked(fsList).mockClear();
      vi.mocked(wcStatusMap).mockClear();
      return opened;
    }

    it('refreshes the statuses of all the copy tabs', async () => {
      const { explorer, first, second } = await withDocument();
      vi.mocked(wcStatusMap).mockResolvedValue(
        statusMap([status('wc\\a.txt')]),
      );
      await explorer.refreshStatus();
      expect(wcStatusMap).toHaveBeenCalledTimes(2);
      expect(keysOf(explorer, first)).toEqual(['wc\\a.txt']);
      expect(keysOf(explorer, second)).toEqual(['wc\\a.txt']);
    });

    it('refreshes their statuses after a change and leaves the listings stale for later', async () => {
      const { explorer, first, second } = await withDocument();
      vi.mocked(wcStatusMap).mockResolvedValue(
        statusMap([status('wc\\a.txt')]),
      );
      await explorer.reloadAfterChange();
      expect(fsList).not.toHaveBeenCalled();
      expect(wcStatusMap).toHaveBeenCalledTimes(2);
      expect(keysOf(explorer, first)).toEqual(['wc\\a.txt']);
      expect(explorer.stateOf(first)?.isStale).toBe(true);
      expect(explorer.stateOf(second)?.isStale).toBe(true);
    });
  });

  it('does nothing without tabs', async () => {
    setActivePinia(createPinia());
    const explorer = useExplorerStore();
    await explorer.reloadAfterChange();
    await explorer.refreshStatus();
    expect(fsList).not.toHaveBeenCalled();
    expect(wcStatusMap).not.toHaveBeenCalled();
  });
});

describe('badges and order', () => {
  const FILES = [entry('limpio.txt'), entry('roto.txt'), entry('mod.txt')];
  const MAP = statusMap([
    status('wc\\roto.txt', { item: 'conflicted' }),
    status('wc\\mod.txt'),
  ]);

  it('has no badges while there is no answer', async () => {
    const slow = deferred<WcStatusMap>();
    vi.mocked(wcStatusMap).mockReturnValueOnce(slow.promise);
    const { explorer, tabId } = await opened('wc', listing('wc', FILES, COPY));
    expect(explorer.statusBadges(tabId, FILES).size).toBe(0);
  });

  it('gives each entry its badges, normal ones included', async () => {
    vi.mocked(wcStatusMap).mockResolvedValueOnce(MAP);
    const { explorer, tabId } = await opened('wc', listing('wc', FILES, COPY));
    const badges = explorer.statusBadges(tabId, FILES);
    const keys = (name: string) => badges.get(name)?.map((b) => b.key);
    expect(keys('roto.txt')).toEqual(['conflicted']);
    expect(keys('mod.txt')).toEqual(['modified']);
    expect(keys('limpio.txt')).toEqual(['normal']);
  });

  it('orders by status with what needs attention first', async () => {
    vi.mocked(wcStatusMap).mockResolvedValueOnce(MAP);
    const { explorer, tabId } = await opened('wc', listing('wc', FILES, COPY));
    explorer.updateView(tabId, { sort: 'status' });
    const names = explorer.visibleOf(tabId).map((item) => item.name);
    expect(names).toEqual(['roto.txt', 'mod.txt', 'limpio.txt']);
    explorer.updateView(tabId, { sort_direction: 'desc' });
    const reversed = explorer.visibleOf(tabId).map((item) => item.name);
    expect(reversed).toEqual(['limpio.txt', 'mod.txt', 'roto.txt']);
  });

  it('falls back to name order by status when the answer failed', async () => {
    vi.mocked(wcStatusMap).mockRejectedValueOnce({ kind: 'io', message: 'x' });
    const { explorer, tabId } = await opened('wc', listing('wc', FILES, COPY));
    explorer.updateView(tabId, { sort: 'status' });
    const names = explorer.visibleOf(tabId).map((item) => item.name);
    expect(names).toEqual(['limpio.txt', 'mod.txt', 'roto.txt']);
  });

  it('flags a folder that contains changes', async () => {
    const folders = [
      entry('src', { kind: 'dir' }),
      entry('docs', { kind: 'dir' }),
    ];
    vi.mocked(wcStatusMap).mockResolvedValueOnce(
      statusMap([status('wc\\src\\a.txt')], {
        changed_folders: ['wc', 'wc\\src'],
      }),
    );
    const { explorer, tabId } = await opened(
      'wc',
      listing('wc', folders, COPY),
    );
    const badges = explorer.statusBadges(tabId, folders);
    expect(badges.get('src')?.map((b) => b.key)).toEqual(['contains_changes']);
    expect(badges.get('docs')?.map((b) => b.key)).toEqual(['normal']);
  });
});
