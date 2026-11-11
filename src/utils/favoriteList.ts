import type { Favorite, Located } from '../services/filesApi';
import {
  ROOT_FOLDER_LABEL,
  normalizedPath,
  pathKey,
  pathSegments,
} from './folderPaths';

export type FavoriteItem = Located<Favorite>;

export const MAX_FAVORITES = 200;
export const MAX_FAVORITE_NAME_CHARS = 256;

export function defaultFavoriteName(path: string): string {
  return pathSegments(path).pop() ?? ROOT_FOLDER_LABEL;
}

function clippedName(name: string): string {
  return Array.from(name.trim()).slice(0, MAX_FAVORITE_NAME_CHARS).join('');
}

export function findFavorite(
  list: readonly FavoriteItem[],
  path: string,
): number {
  const key = pathKey(path);
  return list.findIndex((item) => pathKey(item.path) === key);
}

export function withFavorite(
  list: readonly FavoriteItem[],
  path: string,
  name?: string,
): FavoriteItem[] {
  if (findFavorite(list, path) >= 0) return [...list];
  const label = clippedName(name ?? '') || defaultFavoriteName(path);
  return [
    ...list,
    {
      path: normalizedPath(path),
      name: label,
      exists: true,
    },
  ];
}

export function withoutFavorite(
  list: readonly FavoriteItem[],
  path: string,
): FavoriteItem[] {
  const index = findFavorite(list, path);
  return list.filter((_, position) => position !== index);
}

export function withMovedFavorite(
  list: readonly FavoriteItem[],
  path: string,
  to: number,
): FavoriteItem[] {
  const from = findFavorite(list, path);
  if (from < 0 || !Number.isInteger(to)) return [...list];
  const target = Math.min(Math.max(to, 0), list.length - 1);
  const rest = list.filter((_, position) => position !== from);
  return [...rest.slice(0, target), list[from], ...rest.slice(target)];
}

export function withRenamedFavorite(
  list: readonly FavoriteItem[],
  path: string,
  name: string,
): FavoriteItem[] {
  const label = clippedName(name);
  const index = findFavorite(list, path);
  if (index < 0 || label === '') return [...list];
  return list.map((item, position) =>
    position === index ? { ...item, name: label } : item,
  );
}

export function withAvailability(
  list: readonly FavoriteItem[],
  path: string,
  exists: boolean,
): FavoriteItem[] {
  const index = findFavorite(list, path);
  return list.map((item, position) =>
    position === index ? { ...item, exists } : item,
  );
}
