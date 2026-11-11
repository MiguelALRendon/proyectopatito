import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../services/filesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/filesApi')>()),
  fsList: vi.fn(),
  wcStatusMap: vi.fn(),
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
}));
vi.mock('../../services/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/tauri')>()),
  wcInfo: vi.fn(),
}));
vi.mock('../../composables/useConfirm', () => ({ confirm: vi.fn() }));

import {
  fsList,
  uiStateGet,
  uiStateSet,
  wcStatusMap,
  type DirListing,
  type FileEntry,
} from '../../services/filesApi';
import { wcInfo, type InfoEntry } from '../../services/tauri';
import { useExplorerStore } from '../../stores/explorer';
import { useProjectStore } from '../../stores/project';
import { useTabsStore } from '../../stores/tabs';
import ExplorerSidebar from './ExplorerSidebar.vue';

function entry(name: string, extra: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    kind: 'dir',
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

const LISTINGS: Record<string, FileEntry[]> = {
  '': [
    entry('zeta'),
    entry('Alfa'),
    entry('oculta', { hidden: true }),
    entry('enlace', { escapes_workspace: true, is_link: true }),
    entry('notas.txt', { kind: 'file' }),
    entry('wc'),
  ],
  Alfa: [entry('hija')],
  wc: [entry('src')],
};

function listing(path: string, wc: DirListing['wc'] = null): DirListing {
  return { path, entries: LISTINGS[path] ?? [], truncated: false, wc };
}

let wrapper: VueWrapper;
let tabs: ReturnType<typeof useTabsStore>;
let explorer: ReturnType<typeof useExplorerStore>;

async function mountSidebar() {
  vi.mocked(uiStateGet).mockResolvedValue({
    version: 1,
    favorites: [{ path: 'Alfa', name: 'Mi Alfa', exists: true }],
    tabs: [],
    active_tab: null,
    views: {},
  });
  setActivePinia(createPinia());
  tabs = useTabsStore();
  explorer = useExplorerStore();
  await tabs.restore();
  await explorer.attach(tabs.activeId as string, '');
  wrapper = mount(ExplorerSidebar, { attachTo: document.body });
  await flushPromises();
}

const treeNames = () =>
  wrapper.findAll('[role="treeitem"] .file-tree__name').map((n) => n.text());
const treeItem = (name: string) =>
  wrapper
    .findAll('[role="treeitem"]')
    .find((row) => row.find('.file-tree__name').text() === name)!;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fsList).mockImplementation(async (path) => listing(path));
  vi.mocked(uiStateSet).mockImplementation(async (request) => ({
    ...request,
    favorites: request.favorites.map((item) => ({ ...item, exists: true })),
    tabs: [],
    views: {},
  }));
  vi.mocked(wcInfo).mockResolvedValue({ revision: 1 } as InfoEntry);
  vi.mocked(wcStatusMap).mockResolvedValue({
    entries: [],
    changed_folders: [],
    truncated: false,
    against_revision: null,
  });
});

afterEach(() => wrapper.unmount());

describe('ExplorerSidebar tree', () => {
  it('lists only visible folders inside the workspace, sorted, and never files', async () => {
    await mountSidebar();
    expect(treeNames()).toEqual(['Mis archivos', 'Alfa', 'wc', 'zeta']);
  });

  it('expands a folder reading it lazily', async () => {
    await mountSidebar();
    expect(fsList).not.toHaveBeenCalledWith('Alfa');
    await treeItem('Alfa').get('.file-tree__chevron').trigger('click');
    await flushPromises();
    expect(fsList).toHaveBeenCalledWith('Alfa');
    expect(treeNames()).toContain('hija');
  });

  it('shows a tree error instead of breaking when a folder cannot be read', async () => {
    await mountSidebar();
    vi.mocked(fsList).mockRejectedValueOnce({ kind: 'io', message: 'x' });
    await treeItem('zeta').get('.file-tree__chevron').trigger('click');
    await flushPromises();
    expect(treeItem('zeta').attributes('aria-label')).toContain(
      'no se pudo leer',
    );
  });
});

describe('ExplorerSidebar navigation', () => {
  it('navigates the active folder tab when a folder is chosen', async () => {
    await mountSidebar();
    await treeItem('Alfa').trigger('click');
    await flushPromises();
    expect(explorer.activeState?.location).toBe('Alfa');
    expect(tabs.tabs).toHaveLength(1);
  });

  it('opens a new tab with Ctrl+click and does not duplicate an open one', async () => {
    await mountSidebar();
    await treeItem('Alfa').trigger('click', { ctrlKey: true });
    await treeItem('Alfa').trigger('click', { ctrlKey: true });
    expect(tabs.tabs.map((tab) => tab.path)).toEqual(['', 'Alfa']);
  });

  it('opens a folder tab when the active tab is a document', async () => {
    await mountSidebar();
    tabs.open('notas.txt', 'document');
    await treeItem('zeta').trigger('click');
    expect(tabs.activeTab?.path).toBe('zeta');
    expect(tabs.activeTab?.kind).toBe('folder');
  });

  it('highlights the folder of the active tab', async () => {
    await mountSidebar();
    expect(treeItem('Mis archivos').attributes('aria-selected')).toBe('true');
    await treeItem('Alfa').trigger('click');
    await flushPromises();
    expect(treeItem('Alfa').attributes('aria-selected')).toBe('true');
    expect(treeItem('Mis archivos').attributes('aria-selected')).toBe('false');
  });
});

describe('ExplorerSidebar changed folders', () => {
  it('marks in the tree the folders that contain changes in the open copy', async () => {
    await mountSidebar();
    vi.mocked(wcStatusMap).mockResolvedValue({
      entries: [],
      changed_folders: ['wc', 'wc\\src'],
      truncated: false,
      against_revision: null,
    });
    vi.mocked(fsList).mockImplementation(async (path) =>
      listing(path, path === 'wc' ? { root: 'wc', is_root: true } : null),
    );
    await explorer.navigate(tabs.activeId as string, 'wc');
    await flushPromises();
    expect(treeItem('wc').attributes('aria-label')).toBe(
      'wc, contiene cambios',
    );
    expect(treeItem('zeta').attributes('aria-label')).toBeUndefined();
  });
});

describe('ExplorerSidebar refresh', () => {
  it('shows a folder created by an operation, keeping the open ones open', async () => {
    await mountSidebar();
    await treeItem('Alfa').get('.file-tree__chevron').trigger('click');
    await flushPromises();
    vi.mocked(fsList).mockImplementation(async (path) => ({
      ...listing(path),
      entries: [...listing(path).entries, entry(`nueva-${path || 'raiz'}`)],
    }));
    useProjectStore().finishedOperations += 1;
    await flushPromises();
    expect(treeNames()).toContain('nueva-raiz');
    expect(treeNames()).toContain('nueva-Alfa');
    expect(treeNames()).toContain('hija');
  });
});

describe('ExplorerSidebar happy path', () => {
  it('shows the favorites first and the folder tree below', async () => {
    await mountSidebar();
    const titles = wrapper.findAll('h2').map((title) => title.text());
    expect(titles).toEqual(['Favoritos', 'Carpetas']);
    expect(wrapper.get('.favorites__name').text()).toBe('Mi Alfa');
  });
});
