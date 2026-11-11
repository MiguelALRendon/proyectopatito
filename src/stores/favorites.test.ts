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
  uiStateGet,
  uiStateSet,
  type DirListing,
  type UiStateView,
} from '../services/filesApi';
import { useExplorerStore } from './explorer';
import { useFavoritesStore } from './favorites';
import { PERSIST_DELAY_MS, useTabsStore } from './tabs';

function view(favorites: UiStateView['favorites'] = []): UiStateView {
  return { version: 1, favorites, tabs: [], active_tab: null, views: {} };
}

const listing = (path: string): DirListing => ({
  path,
  entries: [],
  truncated: false,
  wc: null,
});

async function setup(favorites: UiStateView['favorites'] = []) {
  vi.mocked(uiStateGet).mockResolvedValue(view(favorites));
  setActivePinia(createPinia());
  const tabs = useTabsStore();
  const explorer = useExplorerStore();
  const store = useFavoritesStore();
  await tabs.restore();
  vi.mocked(fsList).mockResolvedValue(listing(''));
  await explorer.attach(tabs.activeId as string, '');
  return { tabs, explorer, store };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.mocked(uiStateSet).mockImplementation(async (request) => ({
    ...view(request.favorites.map((item) => ({ ...item, exists: true }))),
  }));
});

afterEach(() => vi.useRealTimers());

describe('opening a favorite', () => {
  it('marks it unavailable when the folder cannot be opened, and keeps the tab where it was', async () => {
    const { tabs, explorer, store } = await setup([
      { path: 'gone', name: 'Gone', exists: true },
    ]);
    vi.mocked(fsList).mockRejectedValueOnce({ kind: 'io', message: 'no' });
    expect(await store.open('gone')).toBe(false);
    expect(store.items[0].exists).toBe(false);
    expect(explorer.activeState?.location).toBe('');
    expect(tabs.tabs).toHaveLength(1);
  });

  it('keeps it available when a newer navigation supersedes the opening', async () => {
    const { tabs, explorer, store } = await setup([
      { path: 'lenta', name: 'Lenta', exists: true },
    ]);
    let finish: (value: DirListing) => void = () => undefined;
    vi.mocked(fsList)
      .mockReturnValueOnce(new Promise<DirListing>((done) => (finish = done)))
      .mockResolvedValueOnce(listing('otra'));
    const opening = store.open('lenta');
    await explorer.navigate(tabs.activeId as string, 'otra');
    finish(listing('lenta'));
    expect(await opening).toBe(false);
    expect(store.items[0].exists).toBe(true);
    expect(explorer.activeState?.location).toBe('otra');
  });

  it('does not delete a favorite it could not open', async () => {
    const { store } = await setup([
      { path: 'gone', name: 'Gone', exists: false },
    ]);
    vi.mocked(fsList).mockRejectedValueOnce({ kind: 'io', message: 'no' });
    await store.open('gone');
    await vi.advanceTimersByTimeAsync(PERSIST_DELAY_MS * 2);
    expect(store.items).toHaveLength(1);
  });

  it('becomes available again when the folder is back', async () => {
    const { store } = await setup([
      { path: 'back', name: 'Back', exists: false },
    ]);
    vi.mocked(fsList).mockResolvedValueOnce(listing('back'));
    expect(await store.open('back')).toBe(true);
    expect(store.items[0].exists).toBe(true);
  });

  it('navigates the active folder tab instead of opening another one', async () => {
    const { tabs, explorer, store } = await setup([
      { path: 'docs', name: 'Docs', exists: true },
    ]);
    vi.mocked(fsList).mockResolvedValueOnce(listing('docs'));
    await store.open('docs');
    expect(tabs.tabs).toHaveLength(1);
    expect(explorer.activeState?.location).toBe('docs');
    expect(tabs.activeTab?.path).toBe('docs');
  });

  it('opens a folder tab when the active tab is a document', async () => {
    const { tabs, store } = await setup([
      { path: 'docs', name: 'Docs', exists: true },
    ]);
    tabs.open('a.txt', 'document');
    await store.open('docs');
    expect(tabs.tabs.map((tab) => tab.path)).toEqual(['', 'a.txt', 'docs']);
    expect(tabs.activeTab?.kind).toBe('folder');
  });
});

describe('toggling a favorite', () => {
  it('adds with the star and removes with the second press, ignoring case', async () => {
    const { store } = await setup();
    store.toggle('Docs');
    expect(store.isFavorite('docs')).toBe(true);
    store.toggle('DOCS/');
    expect(store.isFavorite('Docs')).toBe(false);
    expect(store.items).toEqual([]);
  });

  it('asks the user to remove one when the limit is reached', async () => {
    const full = Array.from({ length: 200 }, (_, n) => ({
      path: `f${n}`,
      name: `f${n}`,
      exists: true,
    }));
    const { tabs, store } = await setup(full);
    store.toggle('una-mas');
    expect(store.isFavorite('una-mas')).toBe(false);
    expect(tabs.notice).toContain('200');
  });
});

describe('favorites keep the rest of the session', () => {
  it('reorders and renames without touching tabs or views', async () => {
    const { tabs, store } = await setup([
      { path: 'a', name: 'A', exists: true },
      { path: 'b', name: 'B', exists: true },
    ]);
    tabs.setView('a', {
      mode: 'list',
      columns: ['size'],
      sort: 'size',
      sort_direction: 'desc',
      updated_ms: 5,
    });
    store.move('b', 0);
    store.rename('a', 'Alfa');
    await tabs.flush();
    const sent = vi.mocked(uiStateSet).mock.calls[0][0];
    expect(sent.favorites).toEqual([
      { path: 'b', name: 'B' },
      { path: 'a', name: 'Alfa' },
    ]);
    expect(sent.tabs).toHaveLength(1);
    expect(sent.views.a.mode).toBe('list');
  });
});

describe('happy path', () => {
  it('adds, lists, renames, reorders and removes', async () => {
    const { store } = await setup();
    store.add('uno');
    store.add('dos', 'Segundo');
    store.move('dos', 0);
    store.rename('uno', 'Primero');
    expect(store.items.map((item) => item.name)).toEqual([
      'Segundo',
      'Primero',
    ]);
    store.remove('dos');
    expect(store.items.map((item) => item.path)).toEqual(['uno']);
  });
});
