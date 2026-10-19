import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { confirm } from '../composables/useConfirm';
import {
  uiStateGet,
  uiStateSet,
  type FolderView,
  type Tab,
  type TabKind,
  type UiState,
  type UiStateView,
} from '../services/filesApi';
import {
  MAX_FAVORITES,
  findFavorite,
  withAvailability,
  withFavorite,
  withMovedFavorite,
  withRenamedFavorite,
  withoutFavorite,
  type FavoriteItem,
} from '../utils/favoriteList';
import {
  ROOT_FOLDER_LABEL,
  normalizedPath,
  pathKey,
  pathSegments,
} from '../utils/folderPaths';

export const MAX_TABS = 64;
export const PERSIST_DELAY_MS = 400;
export const ROOT_TAB_TITLE = ROOT_FOLDER_LABEL;
export const LIMIT_NOTICE = `Se alcanzó el máximo de ${MAX_TABS} pestañas. Cierra alguna para abrir otra.`;
export const FAVORITES_LIMIT_NOTICE = `Se alcanzó el máximo de ${MAX_FAVORITES} favoritos. Quita alguno para agregar otro.`;
export const RESTORE_FAILED_NOTICE =
  'No se pudo restaurar la sesión de pestañas.';
export const SAVE_FAILED_NOTICE = 'No se pudo guardar la sesión de pestañas.';

const DISCARD_TITLE = 'Cambios sin guardar';
const DISCARD_LABEL = 'Cerrar sin guardar';

type Preserved = Pick<UiState, 'version' | 'views'>;

export function tabTitle(path: string): string {
  return pathSegments(path).pop() || ROOT_TAB_TITLE;
}

function byCount(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function omittedNotice(count: number): string {
  const reason = 'de la sesión anterior porque su ruta ya no existe.';
  return byCount(
    count,
    `Se omitió 1 pestaña ${reason}`,
    `Se omitieron ${count} pestañas ${reason}`,
  );
}

export function discardMessage(dirty: Tab[]): string {
  return byCount(
    dirty.length,
    `La pestaña «${dirty[0]?.title}» tiene cambios sin guardar. Si la cierras, se perderán.`,
    `${dirty.length} pestañas tienen cambios sin guardar. Si las cierras, se perderán.`,
  );
}

function withoutExists<T extends { exists: boolean }>(
  item: T,
): Omit<T, 'exists'> {
  const { exists: _exists, ...rest } = item;
  return rest;
}

function plainTab({ id, kind, path, title }: Tab): Tab {
  return { id, kind, path, title };
}

function preservedFrom(view: UiStateView): Preserved {
  const views = Object.entries(view.views).map(
    ([key, folderView]) => [key, withoutExists(folderView)] as const,
  );
  return {
    version: view.version,
    views: Object.fromEntries(views),
  };
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<Tab[]>([]);
  const activeId = ref<string | null>(null);
  const favorites = ref<FavoriteItem[]>([]);
  const dirtyIds = ref<string[]>([]);
  const notice = ref<string | null>(null);
  const isRestoring = ref(false);
  let restoration: Promise<void> | null = null;
  let hasRestoreFailed = false;
  let preserved: Preserved | null = null;
  const localViews = new Map<string, FolderView>();
  let hasUnsavedChanges = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  const activeTab = computed(
    () => tabs.value.find((tab) => tab.id === activeId.value) ?? null,
  );
  const canOpen = computed(() => tabs.value.length < MAX_TABS);
  const hasDirtyTabs = computed(() => dirtyIds.value.length > 0);

  const indexOf = (id: string) => tabs.value.findIndex((tab) => tab.id === id);
  const isDirty = (id: string) => dirtyIds.value.includes(id);

  function snapshot(base: Preserved): UiState {
    return {
      ...base,
      favorites: favorites.value.map(withoutExists),
      views: { ...base.views, ...Object.fromEntries(localViews) },
      tabs: tabs.value.map(plainTab),
      active_tab: activeId.value,
    };
  }

  async function writePending(): Promise<void> {
    if (!hasUnsavedChanges || !preserved) return;
    hasUnsavedChanges = false;
    try {
      const saved = await uiStateSet(snapshot(preserved));
      preserved = preservedFrom(saved);
      if (!hasUnsavedChanges) favorites.value = saved.favorites;
      if (notice.value === SAVE_FAILED_NOTICE) notice.value = null;
    } catch {
      hasUnsavedChanges = true;
      notice.value = SAVE_FAILED_NOTICE;
    }
  }

  function flush(): Promise<void> {
    clearTimeout(timer);
    writing = writing.then(writePending);
    return writing;
  }

  function scheduleWrite() {
    hasUnsavedChanges = true;
    clearTimeout(timer);
    timer = setTimeout(flush, PERSIST_DELAY_MS);
  }

  const isPersistenceOff = () => hasRestoreFailed && preserved === null;

  function announce(text: string) {
    notice.value = isPersistenceOff() ? RESTORE_FAILED_NOTICE : text;
  }

  function save() {
    if (preserved) return scheduleWrite();
    if (!hasRestoreFailed) return;
    void restore().then(() => {
      if (preserved) scheduleWrite();
    });
  }

  function viewOf(path: string): FolderView | null {
    const key = pathKey(path);
    return localViews.get(key) ?? preserved?.views[key] ?? null;
  }

  function setView(path: string, view: FolderView) {
    localViews.set(pathKey(path), view);
    save();
  }

  function setFavorites(next: FavoriteItem[]) {
    favorites.value = next;
    save();
  }

  function addFavorite(path: string, name?: string): boolean {
    if (findFavorite(favorites.value, path) >= 0) return false;
    if (favorites.value.length >= MAX_FAVORITES) {
      announce(FAVORITES_LIMIT_NOTICE);
      return false;
    }
    setFavorites(withFavorite(favorites.value, path, name));
    return true;
  }

  const removeFavorite = (path: string) =>
    setFavorites(withoutFavorite(favorites.value, path));

  const moveFavorite = (path: string, to: number) =>
    setFavorites(withMovedFavorite(favorites.value, path, to));

  const renameFavorite = (path: string, name: string) =>
    setFavorites(withRenamedFavorite(favorites.value, path, name));

  const markFavoriteAvailability = (path: string, exists: boolean) => {
    favorites.value = withAvailability(favorites.value, path, exists);
  };

  function setDirty(id: string, dirty: boolean) {
    const others = dirtyIds.value.filter((dirtyId) => dirtyId !== id);
    dirtyIds.value = dirty && indexOf(id) >= 0 ? [...others, id] : others;
  }

  function activate(id: string) {
    if (indexOf(id) < 0) return;
    activeId.value = id;
    save();
  }

  function addTab(tab: Omit<Tab, 'id'>, position: number): string | null {
    if (isRestoring.value) return null;
    if (!canOpen.value) {
      announce(LIMIT_NOTICE);
      return null;
    }
    const created: Tab = { id: crypto.randomUUID(), ...tab };
    tabs.value.splice(position, 0, created);
    activeId.value = created.id;
    save();
    return created.id;
  }

  function open(
    path: string,
    kind: TabKind = 'folder',
    title?: string,
  ): string | null {
    const clean = normalizedPath(path);
    const existing = tabs.value.find(
      (tab) => pathKey(tab.path) === pathKey(clean),
    );
    if (existing) {
      activate(existing.id);
      return existing.id;
    }
    const created = { kind, path: clean, title: title ?? tabTitle(clean) };
    return addTab(created, tabs.value.length);
  }

  function duplicate(id: string): string | null {
    const index = indexOf(id);
    if (index < 0) return null;
    const { kind, path, title } = tabs.value[index];
    return addTab({ kind, path, title }, index + 1);
  }

  function navigate(id: string, path: string, title?: string) {
    const tab = tabs.value[indexOf(id)];
    if (!tab) return;
    tab.path = normalizedPath(path);
    tab.title = title ?? tabTitle(tab.path);
    save();
  }

  function move(id: string, to: number) {
    const from = indexOf(id);
    if (from < 0 || !Number.isInteger(to)) return;
    const target = Math.min(Math.max(to, 0), tabs.value.length - 1);
    if (from === target) return;
    const [tab] = tabs.value.splice(from, 1);
    tabs.value.splice(target, 0, tab);
    save();
  }

  function successor(removedIndex: number, anchorId?: string): string | null {
    if (anchorId && indexOf(anchorId) >= 0) return anchorId;
    const last = tabs.value.length - 1;
    return tabs.value[Math.min(removedIndex, last)]?.id ?? null;
  }

  function removeTabs(ids: string[], anchorId?: string) {
    const activeIndex = indexOf(activeId.value ?? '');
    tabs.value = tabs.value.filter((tab) => !ids.includes(tab.id));
    dirtyIds.value = dirtyIds.value.filter((id) => !ids.includes(id));
    if (indexOf(activeId.value ?? '') < 0) {
      activeId.value = successor(activeIndex, anchorId);
    }
    save();
  }

  async function confirmDiscard(doomed: Tab[]): Promise<boolean> {
    const dirty = doomed.filter((tab) => isDirty(tab.id));
    if (dirty.length === 0) return true;
    return confirm(discardMessage(dirty), DISCARD_LABEL, DISCARD_TITLE);
  }

  async function closeIds(ids: string[], anchorId?: string): Promise<boolean> {
    const doomed = tabs.value.filter((tab) => ids.includes(tab.id));
    if (doomed.length === 0 || !(await confirmDiscard(doomed))) return false;
    removeTabs(
      doomed.map((tab) => tab.id),
      anchorId,
    );
    return true;
  }

  const close = (id: string) => closeIds([id]);

  function closeOthers(id: string): Promise<boolean> {
    if (indexOf(id) < 0) return Promise.resolve(false);
    const others = tabs.value.filter((tab) => tab.id !== id);
    return closeIds(
      others.map((tab) => tab.id),
      id,
    );
  }

  function closeToTheRight(id: string): Promise<boolean> {
    const index = indexOf(id);
    if (index < 0) return Promise.resolve(false);
    const right = tabs.value.slice(index + 1);
    return closeIds(
      right.map((tab) => tab.id),
      id,
    );
  }

  function applyRestored(view: UiStateView) {
    const kept = view.tabs.filter((tab) => tab.exists).map(withoutExists);
    const omitted = view.tabs.length - kept.length;
    const isActiveKept = kept.some((tab) => tab.id === view.active_tab);
    tabs.value = kept;
    activeId.value = isActiveKept ? view.active_tab : (kept[0]?.id ?? null);
    notice.value = omitted > 0 ? omittedNotice(omitted) : null;
    preserved = preservedFrom(view);
    favorites.value = view.favorites;
  }

  async function readSession(): Promise<void> {
    isRestoring.value = true;
    try {
      applyRestored(await uiStateGet());
      hasRestoreFailed = false;
    } catch {
      notice.value = RESTORE_FAILED_NOTICE;
      hasRestoreFailed = true;
    } finally {
      isRestoring.value = false;
    }
    if (tabs.value.length === 0) open('');
    if (hasRestoreFailed) restoration = null;
  }

  function restore(): Promise<void> {
    restoration ??= readSession();
    return restoration;
  }

  return {
    tabs,
    activeId,
    activeTab,
    notice,
    favorites,
    isRestoring,
    canOpen,
    hasDirtyTabs,
    isDirty,
    setDirty,
    open,
    activate,
    duplicate,
    navigate,
    viewOf,
    setView,
    addFavorite,
    removeFavorite,
    moveFavorite,
    renameFavorite,
    markFavoriteAvailability,
    move,
    close,
    closeOthers,
    closeToTheRight,
    restore,
    flush,
  };
});
