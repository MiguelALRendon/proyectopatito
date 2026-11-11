import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  marketplaceRepoFavorite,
  marketplaceRepoRemove,
  marketplaceRepoSave,
  marketplaceRepoTest,
  marketplaceReposGet,
  type RepoDraft,
  type RepoEntry,
  type RepoTestArgs,
  type RepoTestResult,
} from '../services/marketplaceApi';
import { normalizeError, type CommandError } from '../services/tauri';
import { createTicketGate } from '../utils/ticketGate';

const LOAD_KEY = 'load';
const NAME_LOCALE = 'es';
const NAME_COMPARE = { sensitivity: 'accent' } as const;

const repoKey = (id: number) => `repo:${id}`;

export type TestOutcome =
  { ok: true; result: RepoTestResult } | { ok: false; error: CommandError };

export function compareRepos(a: RepoEntry, b: RepoEntry): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  const byName = a.name.localeCompare(b.name, NAME_LOCALE, NAME_COMPARE);
  return byName || a.id - b.id;
}

export const useMarketplaceStore = defineStore('marketplace', () => {
  const gate = createTicketGate();
  const entries = ref<RepoEntry[]>([]);
  const selectedId = ref<number | null>(null);
  const recovered = ref(false);
  const isLoading = ref(false);
  const error = ref<CommandError | null>(null);
  const repoErrors = ref<Record<number, CommandError>>({});
  const formRequest = ref<{ repo: RepoEntry | null } | null>(null);
  let wasRecoveredDismissed = false;

  const repos = computed(() => [...entries.value].sort(compareRepos));
  const selected = computed(
    () => entries.value.find((repo) => repo.id === selectedId.value) ?? null,
  );

  function setRepoError(id: number, value: CommandError | null) {
    const next = { ...repoErrors.value };
    if (value) next[id] = value;
    else delete next[id];
    repoErrors.value = next;
  }

  function upsert(repo: RepoEntry) {
    const index = entries.value.findIndex((entry) => entry.id === repo.id);
    if (index >= 0) entries.value.splice(index, 1, repo);
    else entries.value.push(repo);
  }

  function reloadIfLoading() {
    if (isLoading.value) void load();
  }

  async function load() {
    const ticket = gate.next(LOAD_KEY);
    isLoading.value = true;
    error.value = null;
    try {
      const view = await marketplaceReposGet();
      if (!gate.isCurrent(LOAD_KEY, ticket)) return;
      entries.value = view.repos;
      recovered.value = view.recovered && !wasRecoveredDismissed;
      if (!selected.value) selectedId.value = null;
    } catch (raw) {
      if (gate.isCurrent(LOAD_KEY, ticket)) error.value = normalizeError(raw);
    } finally {
      if (gate.isCurrent(LOAD_KEY, ticket)) isLoading.value = false;
    }
  }

  async function save(draft: RepoDraft): Promise<RepoEntry> {
    try {
      const repo = await marketplaceRepoSave(draft);
      upsert(repo);
      reloadIfLoading();
      return repo;
    } catch (raw) {
      throw normalizeError(raw);
    }
  }

  async function remove(id: number): Promise<boolean> {
    gate.next(repoKey(id));
    try {
      await marketplaceRepoRemove(id);
    } catch (raw) {
      setRepoError(id, normalizeError(raw));
      return false;
    }
    entries.value = entries.value.filter((repo) => repo.id !== id);
    if (selectedId.value === id) selectedId.value = null;
    setRepoError(id, null);
    reloadIfLoading();
    return true;
  }

  async function toggleFavorite(id: number) {
    const current = entries.value.find((repo) => repo.id === id);
    if (!current) return;
    const key = repoKey(id);
    const ticket = gate.next(key);
    try {
      const repo = await marketplaceRepoFavorite(id, !current.favorite);
      if (!gate.isCurrent(key, ticket)) return;
      upsert(repo);
      setRepoError(id, null);
    } catch (raw) {
      if (gate.isCurrent(key, ticket)) setRepoError(id, normalizeError(raw));
    }
  }

  function select(id: number | null) {
    const exists = entries.value.some((repo) => repo.id === id);
    selectedId.value = exists ? id : null;
  }

  async function testConnection(args: RepoTestArgs): Promise<TestOutcome> {
    try {
      return { ok: true, result: await marketplaceRepoTest(args) };
    } catch (raw) {
      return { ok: false, error: normalizeError(raw) };
    }
  }

  function openForm(repo: RepoEntry | null) {
    formRequest.value = { repo };
  }

  function closeForm() {
    formRequest.value = null;
  }

  function dismissRecovered() {
    wasRecoveredDismissed = true;
    recovered.value = false;
  }

  return {
    repos,
    selected,
    selectedId,
    recovered,
    isLoading,
    error,
    repoErrors,
    formRequest,
    load,
    save,
    remove,
    toggleFavorite,
    select,
    testConnection,
    openForm,
    closeForm,
    dismissRecovered,
  };
});
