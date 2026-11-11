import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../services/marketplaceApi', () => ({
  marketplaceReposGet: vi.fn(),
  marketplaceRepoSave: vi.fn(),
  marketplaceRepoRemove: vi.fn(),
  marketplaceRepoFavorite: vi.fn(),
  marketplaceRepoTest: vi.fn(),
  marketplaceRepoSetLastPath: vi.fn(),
}));

import {
  marketplaceRepoFavorite,
  marketplaceRepoRemove,
  marketplaceRepoSave,
  marketplaceRepoTest,
  marketplaceReposGet,
  type RepoEntry,
  type RepoTestArgs,
} from '../services/marketplaceApi';
import type { CommandError } from '../services/tauri';
import { compareRepos, useMarketplaceStore } from './marketplace';

const SECRET = 'clave-ultra-secreta';

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

const networkError: CommandError = {
  kind: 'network',
  message: 'No se pudo conectar con el servidor.',
  codes: [],
  detail: null,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function loaded(...repos: RepoEntry[]) {
  vi.mocked(marketplaceReposGet).mockResolvedValue({ repos, recovered: false });
}

let store: ReturnType<typeof useMarketplaceStore>;

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  store = useMarketplaceStore();
});

describe('marketplace store: load and order', () => {
  it('loads the repositories and flags a recovered registry', async () => {
    vi.mocked(marketplaceReposGet).mockResolvedValue({
      repos: [repo(1, 'a')],
      recovered: true,
    });
    await store.load();
    expect(store.repos).toHaveLength(1);
    expect(store.recovered).toBe(true);
    expect(store.isLoading).toBe(false);
  });

  it('keeps the dismissed recovered notice dismissed after another load', async () => {
    vi.mocked(marketplaceReposGet).mockResolvedValue({
      repos: [],
      recovered: true,
    });
    await store.load();
    store.dismissRecovered();
    await store.load();
    expect(store.recovered).toBe(false);
  });

  it('puts favorites first and then sorts by name ignoring case', async () => {
    loaded(
      repo(1, 'beta'),
      repo(2, 'Alfa'),
      repo(3, 'zeta', { favorite: true }),
      repo(4, 'Delta', { favorite: true }),
      repo(5, 'ALFA2'),
    );
    await store.load();
    expect(store.repos.map((entry) => entry.name)).toEqual([
      'Delta',
      'zeta',
      'Alfa',
      'ALFA2',
      'beta',
    ]);
  });

  it('breaks name ties by id so the order is stable', () => {
    expect(compareRepos(repo(1, 'a'), repo(2, 'A'))).toBeLessThan(0);
  });

  it('reports a load failure without losing the repositories already shown', async () => {
    loaded(repo(1, 'a'));
    await store.load();
    vi.mocked(marketplaceReposGet).mockRejectedValue(networkError);
    await store.load();
    expect(store.error?.kind).toBe('network');
    expect(store.repos).toHaveLength(1);
    expect(store.isLoading).toBe(false);
  });

  it('discards a late load response superseded by a newer one', async () => {
    const first = deferred<{ repos: RepoEntry[]; recovered: boolean }>();
    vi.mocked(marketplaceReposGet).mockReturnValueOnce(first.promise);
    const slow = store.load();
    loaded(repo(2, 'nuevo'));
    await store.load();
    first.resolve({ repos: [repo(1, 'viejo')], recovered: false });
    await slow;
    expect(store.repos.map((entry) => entry.name)).toEqual(['nuevo']);
    expect(store.isLoading).toBe(false);
  });

  it('does not lose a saved repository when an older load answers later', async () => {
    const late = deferred<{ repos: RepoEntry[]; recovered: boolean }>();
    vi.mocked(marketplaceReposGet).mockReturnValueOnce(late.promise);
    const pending = store.load();
    vi.mocked(marketplaceRepoSave).mockResolvedValue(repo(7, 'guardado'));
    loaded(repo(7, 'guardado'));
    await store.save({
      id: null,
      name: 'guardado',
      url: 'svn://h',
      username: null,
      client_cert: null,
    });
    late.resolve({ repos: [], recovered: false });
    await pending;
    expect(store.repos.map((entry) => entry.id)).toEqual([7]);
  });
});

describe('marketplace store: add, edit, remove, favorite', () => {
  it('adds a saved repository', async () => {
    vi.mocked(marketplaceRepoSave).mockResolvedValue(repo(3, 'nuevo'));
    const saved = await store.save({
      id: null,
      name: 'nuevo',
      url: 'svn://host/3',
      username: null,
      client_cert: null,
    });
    expect(saved.id).toBe(3);
    expect(store.repos).toEqual([saved]);
  });

  it('replaces the entry when editing', async () => {
    loaded(repo(1, 'viejo'));
    await store.load();
    vi.mocked(marketplaceRepoSave).mockResolvedValue(repo(1, 'renombrado'));
    await store.save({
      id: 1,
      name: 'renombrado',
      url: 'svn://host/1',
      username: null,
      client_cert: null,
    });
    expect(store.repos.map((entry) => entry.name)).toEqual(['renombrado']);
  });

  it('rejects with the normalized command error when saving fails', async () => {
    vi.mocked(marketplaceRepoSave).mockRejectedValue({
      kind: 'conflict',
      message: 'Ya existe un repositorio con ese nombre.',
    });
    await expect(
      store.save({
        id: null,
        name: 'x',
        url: 'svn://h',
        username: null,
        client_cert: null,
      }),
    ).rejects.toMatchObject({
      kind: 'conflict',
      message: 'Ya existe un repositorio con ese nombre.',
    });
    expect(store.repos).toEqual([]);
  });

  it('removes a repository and clears the selection if it was selected', async () => {
    loaded(repo(1, 'a'), repo(2, 'b'));
    await store.load();
    store.select(1);
    vi.mocked(marketplaceRepoRemove).mockResolvedValue(undefined);
    expect(await store.remove(1)).toBe(true);
    expect(store.repos.map((entry) => entry.id)).toEqual([2]);
    expect(store.selectedId).toBeNull();
  });

  it('keeps the repository and records the error when removal fails', async () => {
    loaded(repo(1, 'a'));
    await store.load();
    vi.mocked(marketplaceRepoRemove).mockRejectedValue(networkError);
    expect(await store.remove(1)).toBe(false);
    expect(store.repos).toHaveLength(1);
    expect(store.repoErrors[1].kind).toBe('network');
  });

  it('toggles the favorite flag with the opposite value and reorders', async () => {
    loaded(repo(1, 'a'), repo(2, 'b'));
    await store.load();
    vi.mocked(marketplaceRepoFavorite).mockResolvedValue(
      repo(2, 'b', { favorite: true }),
    );
    await store.toggleFavorite(2);
    expect(marketplaceRepoFavorite).toHaveBeenCalledWith(2, true);
    expect(store.repos.map((entry) => entry.id)).toEqual([2, 1]);
  });

  it('a network error on one repository does not touch the others', async () => {
    loaded(repo(1, 'a'), repo(2, 'b'));
    await store.load();
    vi.mocked(marketplaceRepoFavorite).mockRejectedValueOnce(networkError);
    await store.toggleFavorite(1);
    expect(store.repoErrors[1].kind).toBe('network');
    expect(store.repoErrors[2]).toBeUndefined();
    vi.mocked(marketplaceRepoFavorite).mockResolvedValue(
      repo(2, 'b', { favorite: true }),
    );
    await store.toggleFavorite(2);
    expect(store.repoErrors[1].kind).toBe('network');
    expect(store.repos[0].id).toBe(2);
  });

  it('clears a repository error after the next success', async () => {
    loaded(repo(1, 'a'));
    await store.load();
    vi.mocked(marketplaceRepoFavorite).mockRejectedValueOnce(networkError);
    await store.toggleFavorite(1);
    vi.mocked(marketplaceRepoFavorite).mockResolvedValue(
      repo(1, 'a', { favorite: true }),
    );
    await store.toggleFavorite(1);
    expect(store.repoErrors[1]).toBeUndefined();
  });

  it('ignores a favorite response that arrives after the repository was removed', async () => {
    loaded(repo(1, 'a'));
    await store.load();
    const late = deferred<RepoEntry>();
    vi.mocked(marketplaceRepoFavorite).mockReturnValue(late.promise);
    const pending = store.toggleFavorite(1);
    vi.mocked(marketplaceRepoRemove).mockResolvedValue(undefined);
    await store.remove(1);
    late.resolve(repo(1, 'a', { favorite: true }));
    await pending;
    expect(store.repos).toEqual([]);
  });
});

describe('marketplace store: selection and id 0', () => {
  it('treats id 0 as a valid repository everywhere', async () => {
    loaded(repo(0, 'cero'));
    await store.load();
    store.select(0);
    expect(store.selectedId).toBe(0);
    expect(store.selected?.name).toBe('cero');
    vi.mocked(marketplaceRepoFavorite).mockResolvedValue(
      repo(0, 'cero', { favorite: true }),
    );
    await store.toggleFavorite(0);
    expect(store.repos[0].favorite).toBe(true);
    vi.mocked(marketplaceRepoRemove).mockResolvedValue(undefined);
    expect(await store.remove(0)).toBe(true);
    expect(store.selectedId).toBeNull();
  });

  it('ignores a selection of an unknown id', async () => {
    loaded(repo(1, 'a'));
    await store.load();
    store.select(99);
    expect(store.selectedId).toBeNull();
  });

  it('drops the selection when a reload no longer includes the repository', async () => {
    loaded(repo(1, 'a'));
    await store.load();
    store.select(1);
    loaded();
    await store.load();
    expect(store.selectedId).toBeNull();
  });
});

describe('marketplace store: connection test', () => {
  const args: RepoTestArgs = {
    url: 'svn://host/1',
    repo_id: 1,
    username: 'ana',
    password: SECRET,
    no_auth_cache: true,
  };

  it('returns the result of the test', async () => {
    const result = {
      uuid: 'u',
      root: 'svn://host',
      url: args.url,
      revision: 4,
    };
    vi.mocked(marketplaceRepoTest).mockResolvedValue(result);
    expect(await store.testConnection(args)).toEqual({ ok: true, result });
  });

  it('returns the classified error instead of throwing', async () => {
    vi.mocked(marketplaceRepoTest).mockRejectedValue({
      kind: 'auth_required',
      message: 'Faltan credenciales.',
    });
    const outcome = await store.testConnection(args);
    expect(outcome).toMatchObject({
      ok: false,
      error: { kind: 'auth_required' },
    });
  });

  it('never keeps the password in the reactive state', async () => {
    vi.mocked(marketplaceRepoTest).mockResolvedValue({
      uuid: 'u',
      root: 'r',
      url: args.url,
      revision: 1,
    });
    await store.testConnection(args);
    vi.mocked(marketplaceRepoTest).mockRejectedValue(networkError);
    await store.testConnection(args);
    expect(JSON.stringify(store.$state)).not.toContain(SECRET);
  });
});

describe('marketplace store: shared form request', () => {
  it('opens the form for a new repository and closes it', () => {
    store.openForm(null);
    expect(store.formRequest).toEqual({ repo: null });
    store.closeForm();
    expect(store.formRequest).toBeNull();
  });

  it('opens the form to edit the repository with id 0', () => {
    const cero = repo(0, 'cero');
    store.openForm(cero);
    expect(store.formRequest?.repo?.id).toBe(0);
  });
});
