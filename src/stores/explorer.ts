import { computed, markRaw, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import {
  fsList,
  wcStatusMap,
  VIEW_COLUMNS,
  type DirListing,
  type FileEntry,
  type FolderView,
  type SortKey,
  type ViewColumn,
  type WcLocation,
} from '../services/filesApi';
import {
  NO_CREDENTIALS,
  normalizeError,
  wcInfo,
  type CommandError,
  type Credentials,
  type InfoEntry,
} from '../services/tauri';
import { visibleEntries } from '../utils/entryOrder';
import { isSamePath, joinPath, parentPath } from '../utils/folderPaths';
import { badgesRank, type StateBadge } from '../utils/svnBadges';
import {
  badgesAt,
  buildStatusIndex,
  type StatusIndex,
} from '../utils/statusIndex';
import { ROOT_TAB_TITLE, cleanPath, useTabsStore } from './tabs';

export const DEFAULT_VIEW: FolderView = {
  mode: 'grid',
  columns: ['type', 'size', 'modified'],
  sort: 'name',
  sort_direction: 'asc',
  updated_ms: 0,
};

const FOLDER_QUERY = {
  filter: '',
  showHidden: false,
  sort: 'name',
  direction: 'asc',
} as const;

const HEADER_TICKET_SUFFIX = ':wc';
const STATUS_TICKET_SUFFIX = ':status';

export interface WcHeaderState {
  root: string;
  info: InfoEntry | null;
  error: CommandError | null;
  isLoading: boolean;
}

type HeaderOutcome = Pick<WcHeaderState, 'info' | 'error'>;

export interface StatusOverlay {
  root: string;
  isRemote: boolean;
  isLoading: boolean;
  isCheckingServer: boolean;
  index: StatusIndex | null;
  truncated: boolean;
  error: CommandError | null;
  againstRevision: number | null;
}

interface StatusRequest {
  root: string;
  isRemote: boolean;
  refresh: boolean;
  credentials: Credentials;
}

type StatusOutcome = Pick<
  StatusOverlay,
  'index' | 'truncated' | 'error' | 'againstRevision'
>;

export interface FolderState {
  location: string;
  listing: DirListing | null;
  error: CommandError | null;
  isLoading: boolean;
  back: string[];
  forward: string[];
  selection: string[];
  filter: string;
  showHidden: boolean;
  view: FolderView;
  header: WcHeaderState | null;
  status: StatusOverlay | null;
  isStale: boolean;
}

export type ViewChange = Partial<Omit<FolderView, 'updated_ms'>>;

type HistorySide = 'back' | 'forward';

export type NavigateOutcome = 'ok' | 'superseded' | 'failed';

type FetchResult = DirListing | Exclude<NavigateOutcome, 'ok'>;

const isListing = (result: FetchResult): result is DirListing =>
  typeof result !== 'string';

const OPPOSITE_SIDE: Record<HistorySide, HistorySide> = {
  back: 'forward',
  forward: 'back',
};

export function navigationError(path: string, raw: unknown): CommandError {
  const error = normalizeError(raw);
  const place = path === '' ? ROOT_TAB_TITLE : path;
  return { ...error, message: `No se pudo abrir «${place}»: ${error.message}` };
}

function badgesFor(
  state: FolderState,
  index: StatusIndex,
  entry: FileEntry,
): StateBadge[] {
  const path = joinPath(state.location, entry.name);
  return badgesAt(index, path, entry.kind === 'dir');
}

function statusRankFor(
  state: FolderState,
): ((entry: FileEntry) => number) | undefined {
  const index = state.status?.index;
  if (!index || state.view.sort !== 'status') return undefined;
  const entries = state.listing?.entries ?? [];
  const ranks = new Map(
    entries.map((entry) => [
      entry.name,
      badgesRank(badgesFor(state, index, entry)),
    ]),
  );
  return (entry) => ranks.get(entry.name) ?? 0;
}

function visibleFor(state: FolderState): FileEntry[] {
  return visibleEntries(state.listing?.entries ?? [], {
    filter: state.filter,
    showHidden: state.showHidden,
    sort: state.view.sort,
    direction: state.view.sort_direction,
    statusRank: statusRankFor(state),
  });
}

async function readStatus(request: StatusRequest): Promise<StatusOutcome> {
  try {
    const map = await wcStatusMap({
      wc_root: request.root,
      remote: request.isRemote,
      refresh: request.refresh,
      ...request.credentials,
    });
    return {
      index: markRaw(buildStatusIndex(map)),
      truncated: map.truncated,
      error: null,
      againstRevision: map.against_revision,
    };
  } catch (raw) {
    const error = normalizeError(raw);
    return { index: null, truncated: false, error, againstRevision: null };
  }
}

function pendingStatus(
  previous: StatusOverlay | null,
  request: StatusRequest,
): StatusOverlay {
  const kept = previous?.root === request.root ? previous : null;
  return {
    root: request.root,
    isRemote: kept?.isRemote ?? false,
    isLoading: true,
    isCheckingServer: request.isRemote,
    index: kept?.index ?? null,
    truncated: kept?.truncated ?? false,
    error: null,
    againstRevision: kept?.againstRevision ?? null,
  };
}

function settledStatus(
  pending: StatusOverlay,
  request: StatusRequest,
  outcome: StatusOutcome,
): StatusOverlay {
  const settled = { isLoading: false, isCheckingServer: false };
  if (outcome.error && request.isRemote) {
    return { ...pending, ...settled, error: outcome.error };
  }
  return { ...pending, ...settled, ...outcome, isRemote: request.isRemote };
}

function toggledColumns(
  columns: ViewColumn[],
  column: ViewColumn,
): ViewColumn[] {
  const next = new Set(columns);
  if (!next.delete(column)) next.add(column);
  return VIEW_COLUMNS.filter((candidate) => next.has(candidate));
}

export const useExplorerStore = defineStore('explorer', () => {
  const tabs = useTabsStore();
  const folders = ref<Record<string, FolderState>>({});
  const tickets = new Map<string, number>();

  const stateOf = (tabId: string): FolderState | null =>
    folders.value[tabId] ?? null;
  const activeState = computed(() => stateOf(tabs.activeId ?? ''));
  const activeWc = computed(() => activeState.value?.listing?.wc ?? null);

  const nextTicket = (key: string): number => {
    const ticket = (tickets.get(key) ?? 0) + 1;
    tickets.set(key, ticket);
    return ticket;
  };
  const isCurrent = (key: string, ticket: number) =>
    tickets.get(key) === ticket;

  function newState(path: string): FolderState {
    const location = cleanPath(path);
    return {
      location,
      listing: null,
      error: null,
      isLoading: false,
      back: [],
      forward: [],
      selection: [],
      filter: '',
      showHidden: false,
      view: tabs.viewOf(location) ?? DEFAULT_VIEW,
      header: null,
      status: null,
      isStale: false,
    };
  }

  async function fetchListing(
    tabId: string,
    path: string,
  ): Promise<FetchResult> {
    const state = folders.value[tabId];
    if (!state) return 'superseded';
    const ticket = nextTicket(tabId);
    state.isLoading = true;
    try {
      const listing = await fsList(path);
      return isCurrent(tabId, ticket) ? listing : 'superseded';
    } catch (raw) {
      if (!isCurrent(tabId, ticket)) return 'superseded';
      state.error = navigationError(path, raw);
      return 'failed';
    } finally {
      if (isCurrent(tabId, ticket)) state.isLoading = false;
    }
  }

  async function readHeader(root: string): Promise<HeaderOutcome> {
    try {
      return { info: await wcInfo(root), error: null };
    } catch (raw) {
      return { info: null, error: normalizeError(raw) };
    }
  }

  async function loadHeader(tabId: string, root: string) {
    const state = folders.value[tabId];
    if (!state) return;
    const key = `${tabId}${HEADER_TICKET_SUFFIX}`;
    const ticket = nextTicket(key);
    const kept = state.header?.root === root ? state.header.info : null;
    state.header = { root, info: kept, error: null, isLoading: true };
    const outcome = await readHeader(root);
    if (isCurrent(key, ticket)) {
      state.header = { root, ...outcome, isLoading: false };
    }
  }

  function syncHeader(
    tabId: string,
    wc: WcLocation | null,
    isRefresh: boolean,
  ) {
    const state = folders.value[tabId];
    if (!state) return;
    if (wc === null) {
      nextTicket(`${tabId}${HEADER_TICKET_SUFFIX}`);
      state.header = null;
      return;
    }
    if (isRefresh || state.header?.root !== wc.root)
      void loadHeader(tabId, wc.root);
  }

  async function loadStatus(tabId: string, request: StatusRequest) {
    const state = folders.value[tabId];
    if (!state) return;
    const key = `${tabId}${STATUS_TICKET_SUFFIX}`;
    const ticket = nextTicket(key);
    const pending = pendingStatus(state.status, request);
    state.status = pending;
    const outcome = await readStatus(request);
    if (isCurrent(key, ticket)) {
      state.status = settledStatus(pending, request, outcome);
    }
  }

  function syncStatus(
    tabId: string,
    wc: WcLocation | null,
    isRefresh: boolean,
  ) {
    const state = folders.value[tabId];
    if (!state) return;
    if (wc === null) {
      nextTicket(`${tabId}${STATUS_TICKET_SUFFIX}`);
      state.status = null;
      return;
    }
    if (!isRefresh && state.status?.root === wc.root) return;
    const credentials = NO_CREDENTIALS;
    void loadStatus(tabId, {
      root: wc.root,
      isRemote: false,
      refresh: isRefresh,
      credentials,
    });
  }

  function syncTab(tabId: string, path: string) {
    const tab = tabs.tabs.find((candidate) => candidate.id === tabId);
    if (tab && tab.path !== path) tabs.navigate(tabId, path);
  }

  function enterLocation(state: FolderState, path: string) {
    state.selection = [];
    state.filter = '';
    state.view = tabs.viewOf(path) ?? DEFAULT_VIEW;
  }

  function showListing(tabId: string, listing: DirListing, isRefresh = false) {
    const state = folders.value[tabId];
    if (!state) return;
    if (!state.listing || !isSamePath(state.location, listing.path)) {
      enterLocation(state, listing.path);
    }
    const names = new Set(listing.entries.map((entry) => entry.name));
    state.selection = state.selection.filter((name) => names.has(name));
    Object.assign(state, {
      listing,
      error: null,
      location: listing.path,
    });
    state.isStale = false;
    syncTab(tabId, listing.path);
    syncHeader(tabId, listing.wc, isRefresh);
    syncStatus(tabId, listing.wc, isRefresh);
  }

  async function attach(tabId: string, path: string): Promise<void> {
    const existing = folders.value[tabId];
    if (existing) {
      if (existing.isStale) await reload(tabId);
      return;
    }
    folders.value[tabId] = newState(path);
    const listing = await fetchListing(tabId, path);
    if (isListing(listing)) showListing(tabId, listing);
  }

  async function navigate(
    tabId: string,
    path: string,
  ): Promise<NavigateOutcome> {
    const state = folders.value[tabId];
    if (!state) return 'superseded';
    const listing = await fetchListing(tabId, path);
    if (!isListing(listing)) return listing;
    if (!isSamePath(state.location, listing.path)) {
      state.back.push(state.location);
      state.forward = [];
    }
    showListing(tabId, listing);
    return 'ok';
  }

  async function step(tabId: string, side: HistorySide): Promise<boolean> {
    const state = folders.value[tabId];
    const stack = state?.[side];
    const target = stack?.[stack.length - 1];
    if (!state || target === undefined) return false;
    const listing = await fetchListing(tabId, target);
    if (!isListing(listing)) return false;
    const origin = state.location;
    state[side].pop();
    state[OPPOSITE_SIDE[side]].push(origin);
    showListing(tabId, listing);
    return true;
  }

  const goBack = (tabId: string) => step(tabId, 'back');
  const goForward = (tabId: string) => step(tabId, 'forward');

  async function goUp(tabId: string): Promise<boolean> {
    const state = folders.value[tabId];
    if (!state || state.location === '') return false;
    return (await navigate(tabId, parentPath(state.location))) === 'ok';
  }

  async function reload(tabId: string): Promise<boolean> {
    const state = folders.value[tabId];
    if (!state) return false;
    const listing = await fetchListing(tabId, state.location);
    if (!isListing(listing)) return false;
    showListing(tabId, listing, true);
    return true;
  }

  function markOthersStale(exceptId: string | null) {
    Object.entries(folders.value).forEach(([id, state]) => {
      if (id !== exceptId) state.isStale = true;
    });
  }

  function refreshStatusOf(tabId: string): Promise<void> {
    const wc = folders.value[tabId]?.listing?.wc;
    if (!wc) return Promise.resolve();
    return loadStatus(tabId, {
      root: wc.root,
      isRemote: false,
      refresh: true,
      credentials: NO_CREDENTIALS,
    });
  }

  async function refreshStatusExcept(exceptId: string | null): Promise<void> {
    const ids = Object.keys(folders.value).filter((id) => id !== exceptId);
    await Promise.all(ids.map(refreshStatusOf));
  }

  async function reloadAfterChange(): Promise<void> {
    const id = tabs.activeId;
    markOthersStale(id);
    await Promise.all([id ? reload(id) : null, refreshStatusExcept(id)]);
  }

  async function checkServer(
    tabId: string,
    credentials: Credentials = NO_CREDENTIALS,
  ): Promise<void> {
    const wc = folders.value[tabId]?.listing?.wc;
    if (!wc) return;
    await loadStatus(tabId, {
      root: wc.root,
      isRemote: true,
      refresh: true,
      credentials,
    });
  }

  const refreshStatus = () => refreshStatusExcept(null);

  async function listSubfolders(path: string): Promise<string[]> {
    const listing = await fsList(path);
    return visibleEntries(listing.entries, FOLDER_QUERY)
      .filter((entry) => entry.kind === 'dir' && !entry.escapes_workspace)
      .map((entry) => entry.name);
  }

  function statusBadges(
    tabId: string,
    entries: readonly FileEntry[],
  ): Map<string, StateBadge[]> {
    const state = folders.value[tabId];
    const index = state?.status?.index;
    if (!state || !index) return new Map();
    return new Map(
      entries.map((entry) => [entry.name, badgesFor(state, index, entry)]),
    );
  }

  async function openPath(
    tabId: string,
    path: string,
    inNewTab: boolean,
  ): Promise<void> {
    if (inNewTab) tabs.open(path);
    else await navigate(tabId, path);
  }

  async function openEntry(
    tabId: string,
    name: string,
    inNewTab = false,
  ): Promise<void> {
    const state = folders.value[tabId];
    const entry = state?.listing?.entries.find((item) => item.name === name);
    if (!state || !entry || entry.escapes_workspace) return;
    const path = joinPath(state.location, entry.name);
    if (entry.kind === 'file') tabs.open(path, 'document');
    else await openPath(tabId, path, inNewTab);
  }

  function dropHiddenSelection(state: FolderState) {
    const visible = new Set(visibleFor(state).map((entry) => entry.name));
    state.selection = state.selection.filter((name) => visible.has(name));
  }

  function select(tabId: string, names: string[]) {
    const state = folders.value[tabId];
    if (state) state.selection = names;
  }

  function setFilter(tabId: string, text: string) {
    const state = folders.value[tabId];
    if (!state) return;
    state.filter = text;
    dropHiddenSelection(state);
  }

  function toggleHidden(tabId: string) {
    const state = folders.value[tabId];
    if (!state) return;
    state.showHidden = !state.showHidden;
    dropHiddenSelection(state);
  }

  function updateView(tabId: string, change: ViewChange) {
    const state = folders.value[tabId];
    if (!state) return;
    state.view = { ...state.view, ...change, updated_ms: Date.now() };
    tabs.setView(state.location, state.view);
  }

  function toggleColumn(tabId: string, column: ViewColumn) {
    const state = folders.value[tabId];
    if (state)
      updateView(tabId, {
        columns: toggledColumns(state.view.columns, column),
      });
  }

  function sortBy(tabId: string, key: SortKey) {
    const state = folders.value[tabId];
    if (!state) return;
    const isSame = state.view.sort === key;
    const isAscending = state.view.sort_direction === 'asc';
    const direction = isSame && isAscending ? 'desc' : 'asc';
    updateView(tabId, { sort: key, sort_direction: direction });
  }

  function discard(tabId: string) {
    delete folders.value[tabId];
    tickets.delete(tabId);
    tickets.delete(`${tabId}${HEADER_TICKET_SUFFIX}`);
    tickets.delete(`${tabId}${STATUS_TICKET_SUFFIX}`);
  }

  watch(
    () => tabs.tabs.map((tab) => tab.id),
    (ids) => {
      Object.keys(folders.value)
        .filter((id) => !ids.includes(id))
        .forEach(discard);
    },
  );

  return {
    folders,
    activeState,
    activeWc,
    stateOf,
    visibleOf: (tabId: string) => {
      const state = folders.value[tabId];
      return state ? visibleFor(state) : [];
    },
    attach,
    navigate,
    goBack,
    goForward,
    goUp,
    reload,
    reloadAfterChange,
    refreshStatus,
    listSubfolders,
    checkServer,
    statusBadges,
    openPath,
    openEntry,
    select,
    setFilter,
    toggleHidden,
    updateView,
    toggleColumn,
    sortBy,
  };
});
