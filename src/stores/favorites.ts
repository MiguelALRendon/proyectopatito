import { computed } from 'vue';
import { defineStore } from 'pinia';
import { findFavorite } from '../utils/favoriteList';
import { useExplorerStore } from './explorer';
import { useTabsStore } from './tabs';

export const useFavoritesStore = defineStore('favorites', () => {
  const tabs = useTabsStore();
  const explorer = useExplorerStore();

  const items = computed(() => tabs.favorites);
  const isFavorite = (path: string) => findFavorite(tabs.favorites, path) >= 0;

  function toggle(path: string) {
    if (isFavorite(path)) tabs.removeFavorite(path);
    else tabs.addFavorite(path);
  }

  async function open(path: string): Promise<boolean> {
    const tab = tabs.activeTab;
    if (tab?.kind !== 'folder') return tabs.open(path) !== null;
    const outcome = await explorer.navigate(tab.id, path);
    if (outcome !== 'superseded') {
      tabs.markFavoriteAvailability(path, outcome === 'ok');
    }
    return outcome === 'ok';
  }

  return {
    items,
    isFavorite,
    toggle,
    open,
    add: tabs.addFavorite,
    remove: tabs.removeFavorite,
    move: tabs.moveFavorite,
    rename: tabs.renameFavorite,
  };
});
