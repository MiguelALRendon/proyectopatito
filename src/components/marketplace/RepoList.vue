<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { confirm } from '../../composables/useConfirm';
import type { RepoEntry } from '../../services/marketplaceApi';
import { useMarketplaceStore } from '../../stores/marketplace';
import { focusTarget } from '../../utils/listFocus';
import ErrorBanner from '../ErrorBanner.vue';
import {
  FAVORITE_FOCUS,
  KEY_DELETE,
  KEY_RENAME,
} from '../explorer/favoriteKeys';
import AppIcon from '../icons/AppIcon.vue';
import CertificatesDialog from './CertificatesDialog.vue';
import RepoForm from './RepoForm.vue';

const EMPTY_HINT = 'Aún no hay repositorios.';
const LOADING_HINT = 'Cargando repositorios…';
const RECOVERED_NOTICE =
  'Se conservó una copia de seguridad de la lista dañada.';
const RECOVERED_PATH = 'config.json.marketplace.bad';
const REMOVE_LABEL = 'Quitar';
const REMOVE_TITLE = 'Quitar repositorio';

const store = useMarketplaceStore();
const itemElements = new Map<number, HTMLElement>();
const isCertificatesOpen = ref(false);

onMounted(() => store.load());

function setItemElement(id: number, element: unknown) {
  if (element instanceof HTMLElement) itemElements.set(id, element);
  else itemElements.delete(id);
}

async function focusLink(id: number | undefined) {
  await nextTick();
  const element = id === undefined ? undefined : itemElements.get(id);
  element?.querySelector<HTMLElement>('.repo-list__link')?.focus();
}

async function closeForm(savedId?: number) {
  const returnTo = savedId ?? store.formRequest?.repo?.id;
  store.closeForm();
  if (returnTo !== undefined) await focusLink(returnTo);
}

async function removeAt(repo: RepoEntry, index: number) {
  const message = `¿Quitar «${repo.name}» de la lista? El repositorio no se borra del servidor.`;
  if (!(await confirm(message, REMOVE_LABEL, REMOVE_TITLE))) return;
  if (!(await store.remove(repo.id))) return;
  const next = store.repos[Math.min(index, store.repos.length - 1)];
  await focusLink(next?.id);
}

function focusNeighbour(key: string, index: number): boolean {
  const target = focusTarget(key, index, store.repos.length, FAVORITE_FOCUS);
  if (target === null) return false;
  void focusLink(store.repos[target].id);
  return true;
}

function runKey(event: KeyboardEvent, repo: RepoEntry, index: number) {
  if (event.key === KEY_DELETE) void removeAt(repo, index);
  else if (event.key === KEY_RENAME) store.openForm(repo);
  else return focusNeighbour(event.key, index);
  return true;
}

function handleKeydown(event: KeyboardEvent, repo: RepoEntry, index: number) {
  if (runKey(event, repo, index)) event.preventDefault();
}
</script>

<template>
  <section class="repo-list" aria-labelledby="repo-list-title">
    <h2 id="repo-list-title" class="repo-list__title">
      <AppIcon name="server" class="repo-list__title-icon" />
      Repositorios
    </h2>
    <div class="repo-list__toolbar">
      <button
        type="button"
        class="btn btn--primary repo-list__add"
        @click="store.openForm(null)"
      >
        <AppIcon name="add" />
        Agregar repositorio
      </button>
      <button
        type="button"
        class="btn repo-list__add"
        @click="isCertificatesOpen = true"
      >
        <AppIcon name="lock" />
        Certificados
      </button>
    </div>
    <div v-if="store.recovered" class="banner banner--warning" role="status">
      <span :title="RECOVERED_PATH">{{ RECOVERED_NOTICE }}</span>
      <button type="button" class="btn" @click="store.dismissRecovered()">
        Descartar aviso
      </button>
    </div>
    <ErrorBanner v-if="store.error" :error="store.error" />
    <p v-if="store.isLoading && store.repos.length === 0" role="status">
      {{ LOADING_HINT }}
    </p>
    <p
      v-else-if="store.repos.length === 0 && !store.error"
      class="repo-list__empty"
    >
      {{ EMPTY_HINT }}
    </p>
    <ul
      v-else-if="store.repos.length"
      class="repo-list__list"
      aria-label="Repositorios registrados"
    >
      <li
        v-for="(repo, index) in store.repos"
        :key="repo.id"
        :ref="(element) => setItemElement(repo.id, element)"
        class="repo-list__item"
      >
        <div class="repo-list__row">
          <button
            type="button"
            class="repo-list__link"
            :aria-current="store.selectedId === repo.id ? 'true' : undefined"
            :title="repo.url"
            aria-keyshortcuts="F2 Delete"
            @click="store.select(repo.id)"
            @keydown="handleKeydown($event, repo, index)"
          >
            <span class="repo-list__name">{{ repo.name }}</span>
            <span class="repo-list__url">{{ repo.url }}</span>
          </button>
          <button
            type="button"
            class="repo-list__star"
            :aria-pressed="repo.favorite"
            :aria-label="`Favorito ${repo.name}`"
            @click="store.toggleFavorite(repo.id)"
          >
            <AppIcon name="star" />
          </button>
          <!-- fuera del orden de tabulación: F2 y Supr son la vía de teclado -->
          <button
            type="button"
            class="repo-list__action"
            tabindex="-1"
            :aria-label="`Editar el repositorio ${repo.name}`"
            @click="store.openForm(repo)"
          >
            <AppIcon name="edit" />
          </button>
          <button
            type="button"
            class="repo-list__action repo-list__action--remove"
            tabindex="-1"
            :aria-label="`Quitar el repositorio ${repo.name}`"
            @click="removeAt(repo, index)"
          >
            <AppIcon name="close" />
          </button>
        </div>
        <p v-if="store.repoErrors[repo.id]" class="field__error" role="alert">
          {{ store.repoErrors[repo.id].message }}
        </p>
      </li>
    </ul>
    <RepoForm
      v-if="store.formRequest"
      :repo="store.formRequest.repo"
      @close="closeForm()"
      @saved="closeForm"
    />
    <CertificatesDialog
      v-if="isCertificatesOpen"
      @close="isCertificatesOpen = false"
    />
  </section>
</template>

<style scoped>
.repo-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.repo-list__title {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--font-size-base);
}

.repo-list__title-icon {
  color: var(--color-primary);
}

.repo-list__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}

.repo-list__add {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
}

.repo-list p {
  margin: 0;
}

.repo-list__empty {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.repo-list__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin: 0;
  padding: 0;
  list-style: none;
}

.repo-list__row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  border: var(--border-width-lg) solid transparent;
  border-radius: var(--radius-xl);
  color: var(--color-text);
}

.repo-list__row:hover,
.repo-list__row:focus-within {
  background-color: var(--color-bg);
}

.repo-list__row:has(.repo-list__link:focus-visible) {
  outline: var(--border-width-lg) solid var(--color-primary);
  outline-offset: var(--outline-offset-focus);
}

.repo-list__link {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-inline-size: 0;
  padding: var(--space-xs) var(--space-sm);
  border: none;
  border-radius: var(--radius-xl);
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.repo-list__link:focus-visible {
  outline: none;
}

.repo-list__link[aria-current='true'] {
  background-color: var(--color-bg);
  box-shadow: var(--shadow-clay);
  color: var(--color-primary);
  font-weight: var(--font-weight-bold);
}

.repo-list__name,
.repo-list__url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-list__url {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: normal;
}

.repo-list__star,
.repo-list__action {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: var(--space-lg);
  block-size: var(--space-lg);
  padding: 0;
  border: none;
  border-radius: var(--radius-xl);
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
}

.repo-list__star {
  border: var(--border-width-sm) solid var(--color-border);
}

.repo-list__star[aria-pressed='true'] {
  border-color: var(--color-primary);
  background-color: var(--color-primary);
  color: var(--color-bg);
}

.repo-list__action {
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.repo-list__row:hover .repo-list__action,
.repo-list__row:focus-within .repo-list__action {
  opacity: 1;
}

.repo-list__action--remove:hover {
  color: var(--color-error);
}

@media (pointer: coarse) {
  .repo-list__action {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .repo-list__action {
    transition: none;
  }
}
</style>
