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
  wcStatusMap,
  type DirListing,
  type FileEntry,
  type WcLocation,
} from '../../services/filesApi';
import { wcInfo, type InfoEntry } from '../../services/tauri';
import { useExplorerStore } from '../../stores/explorer';
import { useTabsStore } from '../../stores/tabs';
import FolderExplorer from './FolderExplorer.vue';

function entry(name: string, extra: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    kind: 'file',
    size: 10,
    modified_ms: 1,
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
  entries: FileEntry[],
  extra: Partial<DirListing> = {},
): DirListing {
  return { path, entries, truncated: false, wc: null, ...extra };
}

const COPY: WcLocation = { root: 'wc', is_root: true };
const INFO = {
  revision: 4,
  relative_url: '^/trunk',
  repository_root: 'svn://h/r',
  working_copy_root: 'C:\\w\\wc',
} as InfoEntry;

let wrapper: VueWrapper;

async function mountExplorer(path: string, first: DirListing) {
  vi.mocked(fsList).mockResolvedValueOnce(first);
  setActivePinia(createPinia());
  const tabs = useTabsStore();
  const tabId = tabs.open(path) as string;
  wrapper = mount(FolderExplorer, {
    props: { tabId },
    attachTo: document.body,
  });
  await flushPromises();
  return { tabs, tabId, explorer: useExplorerStore() };
}

const rowNames = () =>
  wrapper
    .findAll('[role="row"][aria-label]')
    .map((row) => row.attributes('aria-label'));

const button = (label: string) =>
  wrapper
    .findAll('button')
    .find(
      (item) =>
        item.attributes('aria-label') === label || item.text().trim() === label,
    );

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(wcInfo).mockResolvedValue(INFO);
  vi.mocked(wcStatusMap).mockResolvedValue({
    entries: [],
    changed_folders: [],
    truncated: false,
    against_revision: null,
  });
});

afterEach(() => wrapper.unmount());

describe('FolderExplorer errors and empty states', () => {
  it('keeps the listing and shows a clear error when a folder cannot be opened', async () => {
    await mountExplorer(
      'a',
      listing('a', [entry('rota', { kind: 'dir' }), entry('ok.txt')]),
    );
    vi.mocked(fsList).mockRejectedValueOnce({
      kind: 'io',
      message: 'sin permiso',
    });
    await wrapper.get('[aria-label="Carpeta: rota"]').trigger('dblclick');
    await flushPromises();
    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain('No se pudo abrir «a\\rota»: sin permiso');
    expect(rowNames()).toEqual(['Carpeta: rota', 'Archivo: ok.txt']);
    expect(wrapper.get('[aria-label="Ruta de navegación"]').text()).toContain(
      'a',
    );
    expect(button('Atrás')?.attributes('disabled')).toBeDefined();
  });

  it('says the folder is empty and says nothing matches when the filter hides everything', async () => {
    await mountExplorer('vacia', listing('vacia', []));
    expect(wrapper.text()).toContain('Esta carpeta está vacía.');
    expect(wrapper.find('[role="grid"]').exists()).toBe(false);
    await mountExplorer('a', listing('a', [entry('x.txt')]));
    await wrapper.get('input[type="search"]').setValue('zzz');
    expect(wrapper.text()).toContain('Ningún elemento coincide con el filtro.');
  });

  it('warns that a huge folder is truncated', async () => {
    await mountExplorer(
      'grande',
      listing('grande', [entry('a')], { truncated: true }),
    );
    expect(wrapper.get('[role="status"].banner').text()).toContain(
      'demasiados elementos',
    );
  });

  it('shows a loading state before the first listing arrives', async () => {
    vi.mocked(fsList).mockReturnValueOnce(new Promise(() => undefined));
    setActivePinia(createPinia());
    const tabs = useTabsStore();
    const tabId = tabs.open('lenta') as string;
    wrapper = mount(FolderExplorer, { props: { tabId } });
    await flushPromises();
    expect(wrapper.text()).toContain('Cargando…');
    expect(wrapper.find('[role="grid"]').exists()).toBe(false);
  });

  it('shows nothing for a tab that no longer exists', async () => {
    setActivePinia(createPinia());
    wrapper = mount(FolderExplorer, { props: { tabId: 'fantasma' } });
    await flushPromises();
    expect(wrapper.find('section').exists()).toBe(false);
    expect(fsList).not.toHaveBeenCalled();
  });
});

describe('FolderExplorer working copy header', () => {
  it('shows Working Copy inside a copy and Carpeta local outside', async () => {
    await mountExplorer('wc', listing('wc', [entry('a.txt')], { wc: COPY }));
    expect(wrapper.get('[aria-label="Estado de la carpeta"]').text()).toContain(
      'Working Copy',
    );
    expect(wrapper.text()).toContain('svn://h/r');
    await mountExplorer('local', listing('local', [entry('a.txt')]));
    expect(wrapper.get('[aria-label="Estado de la carpeta"]').text()).toContain(
      'Carpeta local',
    );
  });

  it('points an old copy to the bottom panel and keeps the listing for an old copy', async () => {
    vi.mocked(wcInfo).mockRejectedValue({
      kind: 'working_copy_too_old',
      message: 'formato antiguo',
    });
    await mountExplorer(
      'vieja',
      listing('vieja', [entry('a.txt')], {
        wc: { root: 'vieja', is_root: true },
      }),
    );
    expect(wrapper.text()).toContain('revisa el panel inferior');
    expect(wrapper.text()).not.toContain('svn upgrade');
    expect(rowNames()).toEqual(['Archivo: a.txt']);
  });
});

describe('FolderExplorer navigation', () => {
  it('forgets the shift-click anchor of the previous folder when entering another one', async () => {
    await mountExplorer(
      'a',
      listing('a', [entry('docs', { kind: 'dir' }), entry('x.txt')]),
    );
    await wrapper.get('[aria-label="Archivo: x.txt"]').trigger('click');
    vi.mocked(fsList).mockResolvedValueOnce(
      listing('a\docs', [entry('x.txt'), entry('y.txt'), entry('z.txt')]),
    );
    await wrapper.get('[aria-label="Carpeta: docs"]').trigger('dblclick');
    await flushPromises();
    await wrapper
      .get('[aria-label="Archivo: z.txt"]')
      .trigger('click', { shiftKey: true });
    const selected = wrapper
      .findAll('[role="row"][aria-selected="true"]')
      .map((row) => row.attributes('aria-label'));
    expect(selected).toEqual(['Archivo: z.txt']);
  });

  it('enters a folder inside the same tab and offers back afterwards', async () => {
    const { tabs } = await mountExplorer(
      'a',
      listing('a', [entry('docs', { kind: 'dir' })]),
    );
    vi.mocked(fsList).mockResolvedValueOnce(
      listing('a\\docs', [entry('n.md')]),
    );
    await wrapper.get('[aria-label="Carpeta: docs"]').trigger('dblclick');
    await flushPromises();
    expect(rowNames()).toEqual(['Archivo: n.md']);
    expect(tabs.tabs).toHaveLength(1);
    expect(tabs.tabs[0].path).toBe('a\\docs');
    expect(button('Atrás')?.attributes('disabled')).toBeUndefined();
    vi.mocked(fsList).mockResolvedValueOnce(
      listing('a', [entry('docs', { kind: 'dir' })]),
    );
    await button('Atrás')?.trigger('click');
    await flushPromises();
    expect(rowNames()).toEqual(['Carpeta: docs']);
    expect(button('Adelante')?.attributes('disabled')).toBeUndefined();
  });

  it('goes up with the toolbar and with the breadcrumbs', async () => {
    await mountExplorer('a\\b', listing('a\\b', []));
    vi.mocked(fsList).mockResolvedValueOnce(listing('a', []));
    await button('Subir un nivel')?.trigger('click');
    await flushPromises();
    expect(fsList).toHaveBeenLastCalledWith('a');
    vi.mocked(fsList).mockResolvedValueOnce(listing('', []));
    await button('Mis archivos')?.trigger('click');
    await flushPromises();
    expect(fsList).toHaveBeenLastCalledWith('');
    expect(button('Subir un nivel')?.attributes('disabled')).toBeDefined();
  });

  it('opens a breadcrumb in a new tab with ctrl+click without leaving the folder', async () => {
    const { tabs } = await mountExplorer('a\\b', listing('a\\b', []));
    await button('a')?.trigger('click', { ctrlKey: true });
    await flushPromises();
    expect(tabs.tabs.map((tab) => tab.path)).toEqual(['a\\b', 'a']);
    expect(fsList).toHaveBeenCalledTimes(1);
  });

  it('opens a file as a document tab and does not navigate', async () => {
    const { tabs } = await mountExplorer('a', listing('a', [entry('n.md')]));
    await wrapper.get('[aria-label="Archivo: n.md"]').trigger('dblclick');
    expect(tabs.activeTab).toMatchObject({ kind: 'document', path: 'a\\n.md' });
    expect(fsList).toHaveBeenCalledTimes(1);
  });

  it('refreshes the current folder', async () => {
    await mountExplorer('a', listing('a', [entry('viejo.txt')]));
    vi.mocked(fsList).mockResolvedValueOnce(listing('a', [entry('nuevo.txt')]));
    await button('Actualizar')?.trigger('click');
    await flushPromises();
    expect(rowNames()).toEqual(['Archivo: nuevo.txt']);
  });
});

describe('FolderExplorer views, order and filter', () => {
  const content = listing('a', [
    entry('b.txt', { size: 1 }),
    entry('a.txt', { size: 9 }),
    entry('carpeta', { kind: 'dir' }),
    entry('.oculto', { hidden: true }),
  ]);

  it('hides hidden entries until asked and puts folders first', async () => {
    await mountExplorer('a', content);
    expect(rowNames()).toEqual([
      'Carpeta: carpeta',
      'Archivo: a.txt',
      'Archivo: b.txt',
    ]);
    await button('Ocultos')?.trigger('click');
    expect(rowNames()).toContain('Archivo: .oculto');
  });

  it('switches between grid, list and details and remembers the choice for the folder', async () => {
    const { tabs } = await mountExplorer('a', content);
    expect(wrapper.find('.file-grid').exists()).toBe(true);
    await button('Lista')?.trigger('click');
    expect(wrapper.find('.file-list').exists()).toBe(true);
    expect(wrapper.find('[role="columnheader"]').exists()).toBe(false);
    await button('Detalles')?.trigger('click');
    expect(wrapper.findAll('[role="columnheader"]')).toHaveLength(4);
    expect(tabs.viewOf('a')?.mode).toBe('details');
  });

  it('sorts from the details header and from the toolbar', async () => {
    await mountExplorer('a', content);
    await button('Detalles')?.trigger('click');
    await wrapper.findAll('[role="columnheader"] button')[2].trigger('click');
    expect(rowNames().slice(1)).toEqual(['Archivo: b.txt', 'Archivo: a.txt']);
    await wrapper.findAll('[role="columnheader"] button')[2].trigger('click');
    expect(rowNames().slice(1)).toEqual(['Archivo: a.txt', 'Archivo: b.txt']);
    await wrapper.get('select').setValue('name');
    expect(rowNames().slice(1)).toEqual(['Archivo: b.txt', 'Archivo: a.txt']);
  });

  it('turns the type column off from the toolbar', async () => {
    await mountExplorer('a', content);
    await button('Detalles')?.trigger('click');
    await button('Tipo')?.trigger('click');
    expect(
      wrapper.findAll('[role="columnheader"]').map((item) => item.text()),
    ).toEqual(['Nombre', 'Tamaño', 'Modificado']);
  });

  it('filters by name and keeps the selection only for what is still visible', async () => {
    await mountExplorer('a', content);
    await wrapper.get('[aria-label="Archivo: a.txt"]').trigger('click');
    await wrapper
      .get('[aria-label="Archivo: b.txt"]')
      .trigger('click', { ctrlKey: true });
    await wrapper.get('input[type="search"]').setValue('b.');
    expect(rowNames()).toEqual(['Archivo: b.txt']);
    expect(
      wrapper.get('[role="row"][aria-label]').attributes('aria-selected'),
    ).toBe('true');
    await wrapper.get('input[type="search"]').setValue('');
    const selected = wrapper
      .findAll('[role="row"][aria-selected="true"]')
      .map((row) => row.attributes('aria-label'));
    expect(selected).toEqual(['Archivo: b.txt']);
  });
});
