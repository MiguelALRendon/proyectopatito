import type { WcStatusMap } from '../services/filesApi';
import type { StatusEntry } from '../services/tauri';
import {
  CHANGES_BELOW_BADGE,
  entryBadges,
  localBadge,
  sortedBadges,
  type StateBadge,
} from './svnBadges';
import { pathKey } from './folderPaths';

export interface StatusIndex {
  entries: ReadonlyMap<string, StatusEntry>;
  folders: ReadonlySet<string>;
}

const KEY_SEPARATOR = '\\';
const INHERITED_ITEMS: ReadonlySet<string> = new Set([
  'unversioned',
  'ignored',
]);

export function buildStatusIndex(map: WcStatusMap): StatusIndex {
  return {
    entries: new Map(map.entries.map((entry) => [pathKey(entry.path), entry])),
    folders: new Set(map.changed_folders.map(pathKey)),
  };
}

function ancestorKeys(key: string): string[] {
  const segments = key.split(KEY_SEPARATOR);
  const depths = Array.from(
    { length: segments.length - 1 },
    (_, step) => segments.length - 1 - step,
  );
  return depths.map((depth) => segments.slice(0, depth).join(KEY_SEPARATOR));
}

function inheritedBadges(index: StatusIndex, key: string): StateBadge[] {
  const owner = ancestorKeys(key).find((ancestor) =>
    index.entries.has(ancestor),
  );
  const item = owner === undefined ? null : index.entries.get(owner)?.item;
  return item && INHERITED_ITEMS.has(item) ? [localBadge(item)] : [];
}

export function badgesAt(
  index: StatusIndex,
  path: string,
  isFolder: boolean,
): StateBadge[] {
  const key = pathKey(path);
  const own = index.entries.get(key);
  const badges = own ? entryBadges(own) : inheritedBadges(index, key);
  if (isFolder && index.folders.has(key)) badges.push(CHANGES_BELOW_BADGE);
  return sortedBadges(badges);
}
