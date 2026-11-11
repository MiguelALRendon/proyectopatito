import type { FileEntry, SortDirection, SortKey } from '../services/filesApi';

export interface EntryQuery {
  filter: string;
  showHidden: boolean;
  sort: SortKey;
  direction: SortDirection;
  statusRank?: (entry: FileEntry) => number;
}

type Comparator = (first: FileEntry, second: FileEntry) => number;

const COLLATOR = new Intl.Collator('es', {
  numeric: true,
  sensitivity: 'base',
});
const NO_EXTENSION = '';
const DIRECTION_SIGN: Record<SortDirection, number> = { asc: 1, desc: -1 };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : NO_EXTENSION;
}

const byName: Comparator = (first, second) =>
  COLLATOR.compare(first.name, second.name);

const thenByName = (difference: number, first: FileEntry, second: FileEntry) =>
  difference || byName(first, second);

const COMPARATORS: Record<Exclude<SortKey, 'status'>, Comparator> = {
  name: byName,
  type: (first, second) =>
    thenByName(
      COLLATOR.compare(extensionOf(first.name), extensionOf(second.name)),
      first,
      second,
    ),
  size: (first, second) => thenByName(first.size - second.size, first, second),
  modified: (first, second) =>
    thenByName(
      (first.modified_ms ?? 0) - (second.modified_ms ?? 0),
      first,
      second,
    ),
};

function comparatorFor(query: EntryQuery): Comparator {
  if (query.sort !== 'status') return COMPARATORS[query.sort];
  const rank = query.statusRank ?? (() => 0);
  return (first, second) =>
    thenByName(rank(first) - rank(second), first, second);
}

const folderRank = (entry: FileEntry) => (entry.kind === 'dir' ? 0 : 1);

function matchesQuery(entry: FileEntry, query: EntryQuery): boolean {
  if (entry.hidden && !query.showHidden) return false;
  const needle = query.filter.trim().toLocaleLowerCase();
  return entry.name.toLocaleLowerCase().includes(needle);
}

export function visibleEntries(
  entries: readonly FileEntry[],
  query: EntryQuery,
): FileEntry[] {
  const sign = DIRECTION_SIGN[query.direction];
  const compare = comparatorFor(query);
  return entries
    .filter((entry) => matchesQuery(entry, query))
    .sort(
      (first, second) =>
        folderRank(first) - folderRank(second) || sign * compare(first, second),
    );
}
