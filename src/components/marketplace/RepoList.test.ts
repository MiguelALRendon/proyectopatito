import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../services/marketplaceApi', () => ({
  marketplaceReposGet: vi.fn(),
  marketplaceRepoSave: vi.fn(),
  marketplaceRepoRemove: vi.fn(),
  marketplaceRepoFavorite: vi.fn(),
  marketplaceRepoTest: vi.fn(),
  marketplaceRepoSetLastPath: vi.fn(),
  marketplaceCertList: vi.fn(),
  marketplaceCertRevoke: vi.fn(),
  marketplaceCertImport: vi.fn(),
}));
vi.mock('../../composables/useConfirm', () => ({
  confirm: vi.fn(),
  useConfirm: () => ({ message: { value: null } }),
}));

import { confirm } from '../../composables/useConfirm';
import {
  marketplaceRepoFavorite,
  marketplaceCertList,
  marketplaceRepoRemove,
  marketplaceReposGet,
  type RepoEntry,
} from '../../services/marketplaceApi';
import { useMarketplaceStore } from '../../stores/marketplace';
import RepoList from './RepoList.vue';

function repo(id: number, name: string, extra: Partial<RepoEntry> = {}) {
  return {
    id,
    name,
    url: `svn://host/${id}`,
    username: null,
    favorite: false,
    last_path: '',
    uuid: null,
    root: null,
    client_cert: null,
    ...extra,
  } satisfies RepoEntry;
}

let wrapper: VueWrapper;

async function mountList(repos: RepoEntry[], recovered = false) {
  vi.mocked(marketplaceReposGet).mockResolvedValue({ repos, recovered });
  setActivePinia(createPinia());
  wrapper = mount(RepoList, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

const links = () => wrapper.findAll('.repo-list__link');
const names = () => wrapper.findAll('.repo-list__name').map((n) => n.text());
const link = (name: string) =>
  links().find(
    (candidate) => candidate.find('.repo-list__name').text() === name,
  )!;
const focusedName = () =>
  document.activeElement?.querySelector('.repo-list__name')?.textContent;
const formTitle = () => document.body.querySelector('#repo-form-title');

beforeEach(() => vi.resetAllMocks());

afterEach(() => {
  wrapper.unmount();
  vi.restoreAllMocks();
});

describe('RepoList certificates', () => {
  it('opens the trusted certificates dialog from the toolbar and closes it', async () => {
    await mountList([]);
    vi.mocked(marketplaceCertList).mockResolvedValue([]);
    const opener = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Certificados')!;
    await opener.trigger('click');
    await flushPromises();
    expect(document.body.querySelector('#certs-title')?.textContent).toBe(
      'Certificados de confianza',
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(document.body.querySelector('#certs-title')).toBeNull();
  });
});

describe('RepoList states', () => {
  it('explains the empty state and still offers to add a repository', async () => {
    await mountList([]);
    expect(wrapper.text()).toContain('Aún no hay repositorios.');
    expect(wrapper.find('ul').exists()).toBe(false);
    expect(wrapper.text()).toContain('Agregar repositorio');
  });

  it('shows the repositories with favorites first', async () => {
    await mountList([repo(1, 'beta'), repo(2, 'alfa', { favorite: true })]);
    expect(names()).toEqual(['alfa', 'beta']);
    expect(wrapper.get('ul').attributes('aria-label')).toBe(
      'Repositorios registrados',
    );
  });

  it('shows a dismissible notice when the registry was recovered', async () => {
    await mountList([], true);
    expect(wrapper.text()).toContain(
      'Se conservó una copia de seguridad de la lista dañada.',
    );
    expect(wrapper.find('[title="config.json.marketplace.bad"]').exists()).toBe(
      true,
    );
    const dismiss = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Descartar aviso')!;
    await dismiss.trigger('click');
    expect(wrapper.text()).not.toContain('copia de seguridad');
  });

  it('shows the load error inline', async () => {
    vi.mocked(marketplaceReposGet).mockRejectedValue({
      kind: 'io',
      message: 'No se pudo leer la lista.',
    });
    setActivePinia(createPinia());
    wrapper = mount(RepoList, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'No se pudo leer la lista.',
    );
    expect(wrapper.text()).not.toContain('Aún no hay repositorios.');
  });

  it('marks the selected repository with aria-current', async () => {
    await mountList([repo(1, 'a'), repo(2, 'b')]);
    await link('b').trigger('click');
    expect(link('b').attributes('aria-current')).toBe('true');
    expect(link('a').attributes('aria-current')).toBeUndefined();
  });

  it('selects the repository with id 0', async () => {
    await mountList([repo(0, 'cero')]);
    await link('cero').trigger('click');
    expect(useMarketplaceStore().selectedId).toBe(0);
  });
});

describe('RepoList favorite star', () => {
  it('exposes the favorite state with aria-pressed and a stable name', async () => {
    await mountList([repo(1, 'a', { favorite: true }), repo(2, 'b')]);
    const star = (name: string) =>
      wrapper.get(`[aria-label="Favorito ${name}"]`);
    expect(star('a').attributes('aria-pressed')).toBe('true');
    expect(star('b').attributes('aria-pressed')).toBe('false');
  });

  it('toggles the favorite and keeps the name of the control', async () => {
    await mountList([repo(1, 'a')]);
    vi.mocked(marketplaceRepoFavorite).mockResolvedValue(
      repo(1, 'a', { favorite: true }),
    );
    await wrapper.get('[aria-label="Favorito a"]').trigger('click');
    await flushPromises();
    expect(marketplaceRepoFavorite).toHaveBeenCalledWith(1, true);
    expect(
      wrapper.get('[aria-label="Favorito a"]').attributes('aria-pressed'),
    ).toBe('true');
  });

  it('shows the error of a repository under that row only', async () => {
    await mountList([repo(1, 'a'), repo(2, 'b')]);
    vi.mocked(marketplaceRepoFavorite).mockRejectedValue({
      kind: 'network',
      message: 'Sin conexión.',
    });
    await wrapper.get('[aria-label="Favorito a"]').trigger('click');
    await flushPromises();
    const rows = wrapper.findAll('.repo-list__item');
    expect(rows).toHaveLength(2);
    expect(rows[0].find('[role="alert"]').text()).toBe('Sin conexión.');
    expect(rows[1].find('[role="alert"]').exists()).toBe(false);
  });
});

describe('RepoList keyboard', () => {
  it('keeps the edit and remove buttons out of the tab order', async () => {
    await mountList([repo(1, 'a')]);
    const extras = wrapper.findAll('.repo-list__action');
    expect(extras).toHaveLength(2);
    extras.forEach((button) =>
      expect(button.attributes('tabindex')).toBe('-1'),
    );
  });

  it('moves the focus with ArrowDown and ArrowUp without wrapping', async () => {
    await mountList([repo(1, 'a'), repo(2, 'b'), repo(3, 'c')]);
    await link('a').trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(focusedName()).toBe('b');
    await link('b').trigger('keydown', { key: 'ArrowUp' });
    await flushPromises();
    expect(focusedName()).toBe('a');
    await link('a').trigger('keydown', { key: 'ArrowUp' });
    await flushPromises();
    expect(focusedName()).toBe('a');
  });

  it('jumps to the first and last repository with Home and End', async () => {
    await mountList([repo(1, 'a'), repo(2, 'b'), repo(3, 'c')]);
    await link('a').trigger('keydown', { key: 'End' });
    await flushPromises();
    expect(focusedName()).toBe('c');
    await link('c').trigger('keydown', { key: 'Home' });
    await flushPromises();
    expect(focusedName()).toBe('a');
  });

  it('opens the edit form with F2 and returns the focus on cancel', async () => {
    await mountList([repo(1, 'a')]);
    await link('a').trigger('keydown', { key: 'F2' });
    await flushPromises();
    expect(formTitle()?.textContent).toBe('Editar repositorio');
    expect(
      document.body.querySelector<HTMLInputElement>('#repo-form-name')?.value,
    ).toBe('a');
    const cancel = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Cancelar',
    )!;
    cancel.click();
    await flushPromises();
    expect(formTitle()).toBeNull();
    expect(focusedName()).toBe('a');
  });

  it('opens an empty form with the add button', async () => {
    await mountList([]);
    await wrapper.get('.repo-list__add').trigger('click');
    expect(formTitle()?.textContent).toBe('Agregar repositorio');
  });
});

describe('RepoList removal', () => {
  it('asks for confirmation with Delete and removes on accept', async () => {
    await mountList([repo(1, 'a'), repo(2, 'b')]);
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(marketplaceRepoRemove).mockResolvedValue(undefined);
    await link('a').trigger('keydown', { key: 'Delete' });
    await flushPromises();
    expect(vi.mocked(confirm).mock.calls[0][0]).toContain('«a»');
    expect(marketplaceRepoRemove).toHaveBeenCalledWith(1);
    expect(names()).toEqual(['b']);
    expect(focusedName()).toBe('b');
  });

  it('keeps the repository when the confirmation is declined', async () => {
    await mountList([repo(1, 'a')]);
    vi.mocked(confirm).mockResolvedValue(false);
    await link('a').trigger('keydown', { key: 'Delete' });
    await flushPromises();
    expect(marketplaceRepoRemove).not.toHaveBeenCalled();
    expect(names()).toEqual(['a']);
  });

  it('removes with the row button after confirming', async () => {
    await mountList([repo(1, 'a')]);
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(marketplaceRepoRemove).mockResolvedValue(undefined);
    await wrapper
      .get('[aria-label="Quitar el repositorio a"]')
      .trigger('click');
    await flushPromises();
    expect(names()).toEqual([]);
    expect(wrapper.text()).toContain('Aún no hay repositorios.');
  });

  it('removes the repository with id 0', async () => {
    await mountList([repo(0, 'cero')]);
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(marketplaceRepoRemove).mockResolvedValue(undefined);
    await link('cero').trigger('keydown', { key: 'Delete' });
    await flushPromises();
    expect(marketplaceRepoRemove).toHaveBeenCalledWith(0);
    expect(names()).toEqual([]);
  });
});

describe('RepoList accessibility details', () => {
  it('announces the keyboard shortcuts on each repository', async () => {
    await mountList([repo(1, 'a')]);
    expect(link('a').attributes('aria-keyshortcuts')).toBe('F2 Delete');
  });

  it('only the remove button turns red on hover', async () => {
    await mountList([repo(1, 'a')]);
    const [edit, remove] = wrapper.findAll('.repo-list__action');
    expect(edit.classes()).not.toContain('repo-list__action--remove');
    expect(remove.classes()).toContain('repo-list__action--remove');
  });

  it('opens the form when another part of the section asks for it', async () => {
    await mountList([]);
    useMarketplaceStore().openForm(null);
    await flushPromises();
    expect(formTitle()?.textContent).toBe('Agregar repositorio');
  });
});
