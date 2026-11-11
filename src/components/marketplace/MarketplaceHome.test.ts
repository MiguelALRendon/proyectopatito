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
}));

import {
  marketplaceReposGet,
  type RepoEntry,
} from '../../services/marketplaceApi';
import { useMarketplaceStore } from '../../stores/marketplace';
import MarketplaceHome from './MarketplaceHome.vue';

const EMPTY_NOTICE =
  'Agrega tu primer repositorio con el botón «Agregar repositorio».';

const repo = (id: number, name: string): RepoEntry => ({
  id,
  name,
  url: `svn://host/${id}`,
  username: null,
  favorite: false,
  last_path: '',
  uuid: null,
  root: null,
  client_cert: null,
});

let wrapper: VueWrapper;
let store: ReturnType<typeof useMarketplaceStore>;

async function mountHome(repos: RepoEntry[]) {
  vi.mocked(marketplaceReposGet).mockResolvedValue({ repos, recovered: false });
  setActivePinia(createPinia());
  store = useMarketplaceStore();
  await store.load();
  wrapper = mount(MarketplaceHome);
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => wrapper.unmount());

describe('MarketplaceHome', () => {
  it('invites to add the first repository and offers the button', async () => {
    await mountHome([]);
    expect(wrapper.get('[role="status"]').text()).toBe(EMPTY_NOTICE);
    const add = wrapper.get('button');
    expect(add.text()).toBe('Agregar repositorio');
    await add.trigger('click');
    expect(store.formRequest).toEqual({ repo: null });
  });

  it('asks to pick a repository when there are some but none is selected', async () => {
    await mountHome([repo(1, 'a')]);
    expect(wrapper.get('[role="status"]').text()).toBe(
      'Selecciona un repositorio para explorarlo.',
    );
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('keeps a single persistent status paragraph that names the selection', async () => {
    await mountHome([repo(0, 'cero')]);
    store.select(0);
    await flushPromises();
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
    expect(wrapper.get('[role="status"]').text()).toContain('cero');
    expect(wrapper.get('.card').attributes('role')).toBeUndefined();
    expect(wrapper.get('.card').text()).toContain('svn://host/0');
    expect(wrapper.get('.card').text()).toContain(
      'El navegador de repositorios llega en el siguiente paso.',
    );
  });
});
