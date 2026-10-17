import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../services/filesApi';
import { extensionOf, visibleEntries, type EntryQuery } from './entryOrder';

function entry(name: string, extra: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    kind: 'file',
    size: 0,
    modified_ms: null,
    hidden: false,
    read_only: false,
    is_link: false,
    escapes_workspace: false,
    cloud_only: false,
    ...extra,
  };
}

const folder = (name: string, extra: Partial<FileEntry> = {}) =>
  entry(name, { kind: 'dir', ...extra });

const QUERY: EntryQuery = {
  filter: '',
  showHidden: true,
  sort: 'name',
  direction: 'asc',
};

const names = (items: FileEntry[]) => items.map((item) => item.name);

describe('extensions', () => {
  it('has none for names without a dot or with a leading dot only', () => {
    expect(extensionOf('LEEME')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('')).toBe('');
  });

  it('lowercases the last extension', () => {
    expect(extensionOf('Informe.FINAL.PDF')).toBe('pdf');
  });
});

describe('hidden entries and filter', () => {
  it('hides hidden entries unless asked', () => {
    const items = [entry('a.txt'), entry('b.txt', { hidden: true })];
    expect(
      names(visibleEntries(items, { ...QUERY, showHidden: false })),
    ).toEqual(['a.txt']);
    expect(names(visibleEntries(items, QUERY))).toEqual(['a.txt', 'b.txt']);
  });

  it('filters by name ignoring case and surrounding spaces', () => {
    const items = [entry('Informe.md'), entry('datos.csv'), folder('Informes')];
    const result = visibleEntries(items, { ...QUERY, filter: '  INFORME ' });
    expect(names(result)).toEqual(['Informes', 'Informe.md']);
  });

  it('returns nothing when no name matches and never mutates the input', () => {
    const items = [entry('b'), entry('a')];
    expect(visibleEntries(items, { ...QUERY, filter: 'zzz' })).toEqual([]);
    expect(names(items)).toEqual(['b', 'a']);
  });

  it('treats regex characters in the filter as plain text', () => {
    const items = [entry('a.txt'), entry('axtxt')];
    expect(names(visibleEntries(items, { ...QUERY, filter: 'a.t' }))).toEqual([
      'a.txt',
    ]);
    expect(visibleEntries(items, { ...QUERY, filter: '(' })).toEqual([]);
  });
});

describe('folders first', () => {
  it('keeps folders before files in both directions', () => {
    const items = [entry('a.txt'), folder('z'), entry('m.txt'), folder('b')];
    expect(names(visibleEntries(items, QUERY))).toEqual([
      'b',
      'z',
      'a.txt',
      'm.txt',
    ]);
    expect(
      names(visibleEntries(items, { ...QUERY, direction: 'desc' })),
    ).toEqual(['z', 'b', 'm.txt', 'a.txt']);
  });

  it('sorts folders first even when sorting by size or date', () => {
    const items = [
      entry('grande', { size: 900 }),
      folder('carpeta', { modified_ms: 1 }),
    ];
    expect(
      names(
        visibleEntries(items, { ...QUERY, sort: 'size', direction: 'desc' }),
      ),
    ).toEqual(['carpeta', 'grande']);
  });
});

describe('ordering', () => {
  it('orders names naturally: 2 before 10', () => {
    const items = [entry('f10'), entry('f2'), entry('F1')];
    expect(names(visibleEntries(items, QUERY))).toEqual(['F1', 'f2', 'f10']);
  });

  it('orders by type with the name as tie-breaker', () => {
    const items = [entry('b.txt'), entry('a.md'), entry('a.txt'), entry('sin')];
    const result = visibleEntries(items, { ...QUERY, sort: 'type' });
    expect(names(result)).toEqual(['sin', 'a.md', 'a.txt', 'b.txt']);
  });

  it('orders by size and breaks ties by name', () => {
    const items = [
      entry('c', { size: 5 }),
      entry('a', { size: 5 }),
      entry('b', { size: 1 }),
    ];
    const result = visibleEntries(items, { ...QUERY, sort: 'size' });
    expect(names(result)).toEqual(['b', 'a', 'c']);
  });

  it('puts entries without a date first when ascending, last when descending', () => {
    const items = [
      entry('nuevo', { modified_ms: 200 }),
      entry('sin-fecha'),
      entry('viejo', { modified_ms: 100 }),
    ];
    const asc = visibleEntries(items, { ...QUERY, sort: 'modified' });
    expect(names(asc)).toEqual(['sin-fecha', 'viejo', 'nuevo']);
    const desc = visibleEntries(items, {
      ...QUERY,
      sort: 'modified',
      direction: 'desc',
    });
    expect(names(desc)).toEqual(['nuevo', 'viejo', 'sin-fecha']);
  });

  it('falls back to the name for the status order when no status is known', () => {
    const items = [entry('b'), entry('a')];
    expect(names(visibleEntries(items, { ...QUERY, sort: 'status' }))).toEqual([
      'a',
      'b',
    ]);
  });

  describe('by status', () => {
    const RANKS: Record<string, number> = {
      conflicto: 0,
      cambio: 2,
      otro: 2,
      limpio: 9,
    };
    const statusRank = (item: FileEntry) => RANKS[item.name] ?? 9;
    const query: EntryQuery = { ...QUERY, sort: 'status', statusRank };
    const items = [
      entry('limpio'),
      entry('otro'),
      entry('conflicto'),
      entry('cambio'),
    ];

    it('puts what needs attention first and breaks ties by name', () => {
      expect(names(visibleEntries(items, query))).toEqual([
        'conflicto',
        'cambio',
        'otro',
        'limpio',
      ]);
    });

    it('reverses the order when descending', () => {
      const desc = visibleEntries(items, { ...query, direction: 'desc' });
      expect(names(desc)).toEqual(['limpio', 'otro', 'cambio', 'conflicto']);
    });

    it('keeps folders before files whatever their status', () => {
      const mixed = [entry('conflicto'), folder('limpio')];
      expect(names(visibleEntries(mixed, query))).toEqual([
        'limpio',
        'conflicto',
      ]);
    });

    it('ignores the rank function for any other sort key', () => {
      const byName = visibleEntries(items, { ...query, sort: 'name' });
      expect(names(byName)).toEqual(['cambio', 'conflicto', 'limpio', 'otro']);
    });
  });

  it('returns an empty list for an empty folder', () => {
    expect(visibleEntries([], QUERY)).toEqual([]);
  });
});
