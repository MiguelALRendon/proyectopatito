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
  wcStatus: vi.fn(),
  wcNeedsCleanup: vi.fn(),
  runOperation: vi.fn(),
  wcUpdate: vi.fn(),
  wcCleanup: vi.fn(),
}));
vi.mock('../../composables/useConfirm', () => ({
  confirm: vi.fn(),
  resolveConfirm: vi.fn(),
}));

import { fsList, wcStatusMap, type DirListing } from '../../services/filesApi';
import * as service from '../../services/tauri';
import { useExplorerStore } from '../../stores/explorer';
import { useProjectStore } from '../../stores/project';
import { useTabsStore } from '../../stores/tabs';
import { useWorkspaceStore } from '../../stores/workspace';
import InfoPanel from './InfoPanel.vue';

const okResult: service.OperationResult = { status: 'ok', revision: 6 };

function listing(path: string, root: string | null): DirListing {
  const wc = root === null ? null : { root, is_root: root === path };
  return { path, entries: [], truncated: false, wc };
}

let wrapper: VueWrapper;

async function mountPanel(
  path: string,
  root: string | null,
  workspace = 'C:\\ws',
) {
  vi.mocked(fsList).mockResolvedValue(listing(path, root));
  const pinia = createPinia();
  setActivePinia(pinia);
  useWorkspaceStore().root = workspace;
  const tabs = useTabsStore();
  const tabId = tabs.open(path) as string;
  await useExplorerStore().attach(tabId, path);
  wrapper = mount(InfoPanel, { global: { plugins: [pinia] } });
  await flushPromises();
  return { tabs, tabId };
}

const button = (label: string) =>
  wrapper.findAll('button').find((item) => item.text() === label);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(wcStatusMap).mockResolvedValue({
    entries: [],
    changed_folders: [],
    truncated: false,
    against_revision: null,
  });
  vi.mocked(service.wcInfo).mockResolvedValue({
    path: 'wc',
    url: 'svn://h/r',
    revision: 5,
    last_changed_author: 'a',
    last_changed_date: null,
  } as service.InfoEntry);
  vi.mocked(service.wcStatus).mockResolvedValue({
    entries: [],
    against_revision: null,
  });
  vi.mocked(service.wcNeedsCleanup).mockResolvedValue(false);
  vi.mocked(service.wcUpdate).mockResolvedValue(1);
  vi.mocked(service.wcCleanup).mockResolvedValue(2);
});

afterEach(() => wrapper.unmount());

describe('InfoPanel outside a copy', () => {
  it('opens no copy, says so and keeps checkout available', async () => {
    await mountPanel('local', null);
    expect(service.wcStatus).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('no es una copia de trabajo');
    expect(button('Actualizar')).toBeUndefined();
    expect(wrapper.find('#checkout-url').exists()).toBe(true);
  });
});

describe('InfoPanel inside a copy', () => {
  it('opens the root of the copy that contains the current folder', async () => {
    await mountPanel('wc\\sub\\deep', 'wc');
    expect(service.wcStatus).toHaveBeenCalledWith('wc');
    expect(button('Actualizar')).toBeDefined();
    expect(button('Confirmar')).toBeDefined();
    expect(button('Refrescar estado')).toBeDefined();
    expect(wrapper.text()).toContain('svn://h/r');
  });

  it('does not read the copy again while moving inside it, but does for another copy', async () => {
    const { tabs, tabId } = await mountPanel('wc', 'wc');
    const explorer = useExplorerStore();
    vi.mocked(fsList).mockResolvedValue(listing('wc\\sub', 'wc'));
    await explorer.navigate(tabId, 'wc\\sub');
    await flushPromises();
    expect(service.wcStatus).toHaveBeenCalledTimes(1);
    vi.mocked(fsList).mockResolvedValue(listing('otra', 'otra'));
    await explorer.navigate(tabId, 'otra');
    await flushPromises();
    expect(service.wcStatus).toHaveBeenLastCalledWith('otra');
    expect(tabs.tabs).toHaveLength(1);
  });

  it('runs update on the open copy and then reloads the listing of the folder', async () => {
    vi.mocked(service.runOperation).mockImplementation(async (start) => {
      await start();
      return okResult;
    });
    await mountPanel('wc', 'wc');
    vi.mocked(fsList).mockClear();
    await button('Actualizar')?.trigger('click');
    await flushPromises();
    expect(service.wcUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'wc' }),
    );
    expect(fsList).toHaveBeenCalledWith('wc');
  });

  it('offers the refresh action and opens the commit dialog', async () => {
    await mountPanel('wc', 'wc');
    vi.mocked(service.wcStatus).mockClear();
    await button('Refrescar estado')?.trigger('click');
    await flushPromises();
    expect(service.wcStatus).toHaveBeenCalledWith('wc');
    await button('Confirmar')?.trigger('click');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe('InfoPanel while the project is locked', () => {
  it('keeps a copy change made during an operation and opens it once the project is free', async () => {
    let finish: (result: service.OperationResult) => void = () => undefined;
    vi.mocked(service.runOperation).mockImplementation(async (start) => {
      await start();
      return new Promise((done) => (finish = done));
    });
    const { tabId } = await mountPanel('wc', 'wc');
    const project = useProjectStore();
    void project.update();
    await flushPromises();
    expect(project.isLocked).toBe(true);
    vi.mocked(fsList).mockResolvedValue(listing('otra', 'otra'));
    await useExplorerStore().navigate(tabId, 'otra');
    await flushPromises();
    expect(service.wcStatus).not.toHaveBeenCalledWith('otra');
    expect(project.path).toBe('wc');
    finish(okResult);
    await flushPromises();
    expect(project.isLocked).toBe(false);
    expect(service.wcStatus).toHaveBeenLastCalledWith('otra');
    expect(project.path).toBe('otra');
  });

  it('does not retry in a loop a copy that failed to open', async () => {
    vi.mocked(service.wcInfo).mockRejectedValue({
      kind: 'working_copy_too_old',
      message: 'formato antiguo',
    });
    await mountPanel('vieja', 'vieja');
    await flushPromises();
    expect(service.wcStatus).toHaveBeenCalledTimes(1);
  });
});

describe('InfoPanel old and locked copies', () => {
  it('explains an old-format copy and never shows the previous copy as if it were this one', async () => {
    vi.mocked(service.wcInfo).mockRejectedValue({
      kind: 'working_copy_too_old',
      message: 'formato antiguo',
    });
    await mountPanel('vieja', 'vieja');
    expect(wrapper.text()).toContain('svn upgrade');
    expect(button('Actualizar')).toBeUndefined();
    expect(button('Cleanup')).toBeUndefined();
  });

  it('highlights Cleanup for a locked copy and reopens the copy once it is clean', async () => {
    vi.mocked(service.wcInfo).mockRejectedValueOnce({
      kind: 'working_copy_locked',
      message: 'bloqueada',
    });
    vi.mocked(service.wcStatus).mockRejectedValueOnce({
      kind: 'working_copy_locked',
      message: 'bloqueada',
    });
    vi.mocked(service.runOperation).mockImplementation(async (start) => {
      await start();
      return okResult;
    });
    await mountPanel('bloqueada', 'bloqueada');
    const cleanup = button('Cleanup');
    expect(cleanup?.classes()).toContain('btn--primary');
    await cleanup?.trigger('click');
    await flushPromises();
    expect(service.wcCleanup).toHaveBeenCalledWith({ path: 'bloqueada' });
    expect(useProjectStore().path).toBe('bloqueada');
    expect(button('Actualizar')).toBeDefined();
  });
});

describe('InfoPanel OneDrive warning', () => {
  it('warns that reading the status may download files when the copy is under OneDrive', async () => {
    await mountPanel('wc', 'wc', 'C:\\Users\\a\\OneDrive\\Escritorio\\ws');
    const notice = wrapper.get('.banner--warning');
    expect(notice.text()).toContain('OneDrive');
    expect(notice.text()).toContain('descargar archivos');
  });

  it('does not warn for a copy outside OneDrive or for a folder that is not a copy', async () => {
    await mountPanel('wc', 'wc');
    expect(wrapper.find('.banner--warning').exists()).toBe(false);
    wrapper.unmount();
    await mountPanel('local', null, 'C:\\Users\\a\\OneDrive\\ws');
    expect(wrapper.find('.banner--warning').exists()).toBe(false);
  });

  it('warns when the workspace root itself is the copy and lives under OneDrive', async () => {
    await mountPanel('', '', 'D:\\OneDrive - Empresa\\ws');
    expect(wrapper.find('.banner--warning').exists()).toBe(true);
  });
});
