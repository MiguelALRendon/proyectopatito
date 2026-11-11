import { describe, expect, it } from 'vitest';
import {
  MAX_FAVORITE_NAME_CHARS,
  defaultFavoriteName,
  findFavorite,
  withAvailability,
  withFavorite,
  withMovedFavorite,
  withRenamedFavorite,
  withoutFavorite,
  type FavoriteItem,
} from './favoriteList';

const item = (path: string, name = path, exists = true): FavoriteItem => ({
  path,
  name,
  exists,
});

const LIST = [item('a'), item('b'), item('c')];
const paths = (list: FavoriteItem[]) => list.map((entry) => entry.path);

describe('finding a favorite', () => {
  it('ignores case and separators', () => {
    const list = [item('Proyectos\\Uno')];
    expect(findFavorite(list, 'proyectos/uno/')).toBe(0);
    expect(findFavorite(list, 'proyectos')).toBe(-1);
  });
});

describe('adding', () => {
  it('does not duplicate a folder that differs only by case', () => {
    const list = withFavorite([item('Uno')], 'UNO', 'otro');
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Uno');
  });

  it('names the favorite after the folder, or after the root', () => {
    expect(withFavorite([], 'a\\b')[0]).toEqual(item('a\\b', 'b'));
    expect(withFavorite([], '')[0].name).toBe('Mis archivos');
    expect(defaultFavoriteName('x/y')).toBe('y');
  });

  it('ignores a blank name and clips a huge one by characters, not bytes', () => {
    expect(withFavorite([], 'a', '   ')[0].name).toBe('a');
    const long = '😀'.repeat(MAX_FAVORITE_NAME_CHARS + 50);
    const name = withFavorite([], 'a', long)[0].name;
    expect(Array.from(name)).toHaveLength(MAX_FAVORITE_NAME_CHARS);
  });

  it('appends at the end and leaves the original list untouched', () => {
    const list = withFavorite(LIST, 'd');
    expect(paths(list)).toEqual(['a', 'b', 'c', 'd']);
    expect(LIST).toHaveLength(3);
  });
});

describe('removing', () => {
  it('removes only the matching favorite', () => {
    expect(paths(withoutFavorite(LIST, 'B'))).toEqual(['a', 'c']);
  });

  it('leaves the list alone for an unknown path', () => {
    expect(withoutFavorite(LIST, 'zzz')).toEqual(LIST);
  });
});

describe('reordering', () => {
  it('moves a favorite forward and backward', () => {
    expect(paths(withMovedFavorite(LIST, 'a', 2))).toEqual(['b', 'c', 'a']);
    expect(paths(withMovedFavorite(LIST, 'c', 0))).toEqual(['c', 'a', 'b']);
  });

  it('clamps a destination outside the list', () => {
    expect(paths(withMovedFavorite(LIST, 'a', 99))).toEqual(['b', 'c', 'a']);
    expect(paths(withMovedFavorite(LIST, 'c', -5))).toEqual(['c', 'a', 'b']);
  });

  it('refuses a destination that is not an integer or a favorite that does not exist', () => {
    expect(withMovedFavorite(LIST, 'a', Number.NaN)).toEqual(LIST);
    expect(withMovedFavorite(LIST, 'a', 0.5)).toEqual(LIST);
    expect(withMovedFavorite(LIST, 'zzz', 1)).toEqual(LIST);
  });
});

describe('renaming', () => {
  it('trims the name and keeps the path', () => {
    const list = withRenamedFavorite(LIST, 'b', '  Beta  ');
    expect(list[1]).toEqual(item('b', 'Beta'));
  });

  it('ignores a blank name or an unknown favorite', () => {
    expect(withRenamedFavorite(LIST, 'b', '   ')).toEqual(LIST);
    expect(withRenamedFavorite(LIST, 'zzz', 'x')).toEqual(LIST);
  });
});

describe('availability', () => {
  it('marks only one favorite and never touches the others', () => {
    const list = withAvailability(LIST, 'B', false);
    expect(list.map((entry) => entry.exists)).toEqual([true, false, true]);
  });

  it('leaves everything available for an unknown path', () => {
    expect(withAvailability(LIST, 'zzz', false)).toEqual(LIST);
  });
});
