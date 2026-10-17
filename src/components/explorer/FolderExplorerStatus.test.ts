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
  type WcStatusMap,
} from '../../services/filesApi';
import { wcInfo, type InfoEntry, type StatusEntry } from '../../services/tauri';
import { useTabsStore } from '../../stores/tabs';
import FolderExplorer from './FolderExplorer.vue';

const COPY = { root: 'wc', is_root: true };
const PASSWORD = 'clave-de-prueba';

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

function map(
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

const FILES = [
  entry('src', { kind: 'dir' }),
  entry('limpio.txt'),
  entry('roto.txt'),
  entry('mod.txt'),
];

function listing(path: string, wc: DirListing['wc']): DirListing {
  return { path, entries: FILES, truncated: false, wc };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let wrapper: VueWrapper;
let tabs: ReturnType<typeof useTabsStore>;

async function mountExplorer(wc: DirListing['wc'] = COPY) {
  vi.mocked(fsList).mockResolvedValueOnce(listing('wc', wc));
  setActivePinia(createPinia());
  tabs = useTabsStore();
  const tabId = tabs.open('wc') as string;
  wrapper = mount(FolderExplorer, {
    props: { tabId },
    attachTo: document.body,
  });
  await flushPromises();
}

const button = (label: string) =>
  wrapper
    .findAll('button')
    .find(
      (item) =>
        item.attributes('aria-label') === label || item.text().trim() === label,
    )!;
const row = (name: string) =>
  wrapper
    .findAll('[role="row"][aria-label]')
    .find((r) => r.attributes('aria-label')!.startsWith(name))!;
const notices = () =>
  wrapper.findAll('[role="status"]').map((item) => item.text());
const dialog = () => document.querySelector('[role="dialog"]');

async function fillCredentials(user: string, password: string) {
  const username = document.getElementById(
    'credentials-username',
  ) as HTMLInputElement;
  const secret = document.getElementById(
    'credentials-password',
  ) as HTMLInputElement;
  username.value = user;
  username.dispatchEvent(new Event('input'));
  secret.value = password;
  secret.dispatchEvent(new Event('input'));
  document
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(wcInfo).mockResolvedValue({ revision: 4 } as InfoEntry);
  vi.mocked(wcStatusMap).mockResolvedValue(map([]));
});

afterEach(() => {
  wrapper.unmount();
  document.body.innerHTML = '';
});

describe('FolderExplorer outside a working copy', () => {
  it('asks for nothing, shows no notice and disables the server check', async () => {
    await mountExplorer(null);
    expect(wcStatusMap).not.toHaveBeenCalled();
    expect(wrapper.find('.status-notice').exists()).toBe(false);
    expect(button('Comprobar servidor').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('.svn-badge')).toHaveLength(0);
  });
});

describe('FolderExplorer asynchronous states', () => {
  it('shows the listing and the progress first, and the badges when they arrive', async () => {
    const slow = deferred<WcStatusMap>();
    vi.mocked(wcStatusMap).mockReturnValueOnce(slow.promise);
    await mountExplorer();
    expect(wrapper.findAll('[role="row"][aria-label]')).toHaveLength(4);
    expect(notices().join(' ')).toContain('Calculando el estado');
    expect(wrapper.findAll('.svn-badge')).toHaveLength(0);
    slow.resolve(map([status('wc\\roto.txt', { item: 'conflicted' })]));
    await flushPromises();
    expect(notices().join(' ')).not.toContain('Calculando');
    expect(row('Archivo: roto.txt').text()).toContain('En conflicto');
  });

  it('keeps navigation working while the states are still being calculated', async () => {
    vi.mocked(wcStatusMap).mockReturnValueOnce(new Promise(() => undefined));
    await mountExplorer();
    vi.mocked(fsList).mockResolvedValueOnce(listing('wc\\src', COPY));
    await row('Carpeta: src').trigger('dblclick');
    await flushPromises();
    expect(wrapper.get('[aria-label="Ruta de navegación"]').text()).toContain(
      'src',
    );
  });

  it('warns that the calculation failed and keeps the listing', async () => {
    vi.mocked(wcStatusMap).mockRejectedValueOnce({
      kind: 'timed_out',
      message: 'caducó',
    });
    await mountExplorer();
    expect(notices().join(' ')).toContain('No se pudo calcular el estado');
    expect(notices().join(' ')).toContain('caducó');
    expect(wrapper.findAll('[role="row"][aria-label]')).toHaveLength(4);
    expect(wrapper.findAll('.svn-badge')).toHaveLength(0);
  });

  it('tells when the answer was truncated', async () => {
    vi.mocked(wcStatusMap).mockResolvedValueOnce(
      map([status('wc\\mod.txt')], { truncated: true }),
    );
    await mountExplorer();
    expect(notices().join(' ')).toContain('demasiados cambios');
    expect(row('Archivo: mod.txt').text()).toContain('Modificado');
  });

  it('flags folders with changes and puts the states in the names of the rows', async () => {
    vi.mocked(wcStatusMap).mockResolvedValueOnce(
      map([status('wc\\src\\a.txt')], { changed_folders: ['wc', 'wc\\src'] }),
    );
    await mountExplorer();
    expect(row('Carpeta: src').attributes('aria-label')).toBe(
      'Carpeta: src, Contiene cambios',
    );
    expect(row('Archivo: limpio.txt').attributes('aria-label')).toBe(
      'Archivo: limpio.txt',
    );
  });
});

describe('FolderExplorer sorting and column', () => {
  it('orders by status with the conflicts first, without moving the folders', async () => {
    vi.mocked(wcStatusMap).mockResolvedValueOnce(
      map([
        status('wc\\roto.txt', { item: 'conflicted' }),
        status('wc\\mod.txt'),
      ]),
    );
    await mountExplorer();
    await wrapper.get('select').setValue('status');
    await flushPromises();
    const names = wrapper
      .findAll('[role="row"][aria-label]')
      .map((item) => item.attributes('aria-label')!.split(',')[0]);
    expect(names).toEqual([
      'Carpeta: src',
      'Archivo: roto.txt',
      'Archivo: mod.txt',
      'Archivo: limpio.txt',
    ]);
  });

  it('shows the svn column in the details view with a text for every file', async () => {
    vi.mocked(wcStatusMap).mockResolvedValueOnce(map([status('wc\\mod.txt')]));
    await mountExplorer();
    await button('Detalles').trigger('click');
    await button('SVN').trigger('click');
    await flushPromises();
    const cells = wrapper
      .findAll('[role="row"][aria-label]')
      .map((item) => item.findAll('[role="gridcell"]').pop()!.text());
    expect(cells).toEqual([
      'Sin cambios',
      'Sin cambios',
      'Modificado',
      'Sin cambios',
    ]);
  });
});

describe('FolderExplorer server check', () => {
  it('asks the server with the remote flag and shows what changed there', async () => {
    await mountExplorer();
    vi.mocked(wcStatusMap).mockResolvedValueOnce(
      map(
        [status('wc\\mod.txt', { item: 'normal', remote_item: 'modified' })],
        {
          against_revision: 12,
        },
      ),
    );
    await button('Comprobar servidor').trigger('click');
    await flushPromises();
    expect(vi.mocked(wcStatusMap).mock.calls[1][0]).toMatchObject({
      remote: true,
      refresh: true,
    });
    expect(row('Archivo: mod.txt').text()).toContain(
      'Modificado en el servidor',
    );
    expect(notices().join(' ')).toContain('revisión 12');
  });

  it('shows the progress and disables the button while the server answers', async () => {
    await mountExplorer();
    const slow = deferred<WcStatusMap>();
    vi.mocked(wcStatusMap).mockReturnValueOnce(slow.promise);
    await button('Comprobar servidor').trigger('click');
    await flushPromises();
    expect(notices().join(' ')).toContain('Comprobando el servidor');
    expect(button('Comprobar servidor').attributes('disabled')).toBeDefined();
    slow.resolve(map([]));
    await flushPromises();
    expect(button('Comprobar servidor').attributes('disabled')).toBeUndefined();
  });

  it('asks for credentials, retries with them and never leaves the password around', async () => {
    await mountExplorer();
    vi.mocked(wcStatusMap).mockRejectedValueOnce({
      kind: 'auth_required',
      message: 'sin credenciales',
    });
    await button('Comprobar servidor').trigger('click');
    await flushPromises();
    expect(dialog()?.textContent).toContain('Credenciales requeridas');
    vi.mocked(wcStatusMap).mockResolvedValueOnce(
      map([status('wc\\mod.txt', { item: 'normal', remote_item: 'modified' })]),
    );
    await fillCredentials('ana', PASSWORD);
    expect(vi.mocked(wcStatusMap).mock.calls[2][0]).toMatchObject({
      remote: true,
      username: 'ana',
      password: PASSWORD,
    });
    expect(dialog()).toBeNull();
    expect(document.body.innerHTML).not.toContain(PASSWORD);
    expect(wrapper.html()).not.toContain(PASSWORD);
    expect(row('Archivo: mod.txt').text()).toContain('servidor');
  });

  it('asks again when the credentials are rejected', async () => {
    await mountExplorer();
    vi.mocked(wcStatusMap).mockRejectedValue({
      kind: 'auth_required',
      message: 'mal',
    });
    await button('Comprobar servidor').trigger('click');
    await flushPromises();
    await fillCredentials('ana', 'incorrecta');
    expect(dialog()).not.toBeNull();
  });

  it('lets the user cancel and come back through the notice button', async () => {
    await mountExplorer();
    vi.mocked(wcStatusMap).mockRejectedValueOnce({
      kind: 'auth_required',
      message: 'x',
    });
    await button('Comprobar servidor').trigger('click');
    await flushPromises();
    const cancel = [...document.querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === 'Cancelar',
    );
    cancel?.click();
    await flushPromises();
    expect(dialog()).toBeNull();
    await button('Introducir credenciales').trigger('click');
    expect(dialog()).not.toBeNull();
  });

  it('shows the other failures of the server as a notice, keeping the local badges', async () => {
    vi.mocked(wcStatusMap).mockResolvedValueOnce(map([status('wc\\mod.txt')]));
    await mountExplorer();
    vi.mocked(wcStatusMap).mockRejectedValueOnce({
      kind: 'svn_failed',
      message: 'servidor caído',
    });
    await button('Comprobar servidor').trigger('click');
    await flushPromises();
    expect(notices().join(' ')).toContain('servidor caído');
    expect(dialog()).toBeNull();
    expect(row('Archivo: mod.txt').text()).toContain('Modificado');
  });
});

describe('FolderExplorer favorite star', () => {
  const star = () => button('Marcar como favorita');

  it('adds the current folder and removes it on the second press', async () => {
    await mountExplorer();
    expect(star().attributes('aria-pressed')).toBe('false');
    await star().trigger('click');
    expect(tabs.favorites.map((item) => item.path)).toEqual(['wc']);
    expect(star().attributes('aria-pressed')).toBe('true');
    await star().trigger('click');
    expect(tabs.favorites).toEqual([]);
    expect(star().attributes('aria-pressed')).toBe('false');
  });
});
