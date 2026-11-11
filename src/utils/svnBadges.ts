import type { IconName } from './iconPaths';
import type { StatusEntry } from '../services/tauri';
import { entryStates, itemLabel, type Tone } from './svnLabels';

export interface StateBadge {
  key: string;
  label: string;
  tone: Tone;
  icon: IconName;
  rank: number;
}

interface BadgeLook {
  icon: IconName;
  rank: number;
}

const RANK = {
  attention: 0,
  broken: 1,
  change: 2,
  remote: 3,
  locked: 4,
  changesBelow: 5,
  unversioned: 6,
  marker: 7,
  ignored: 8,
  normal: 9,
} as const;

const REMOTE_KEY = 'remote';
const CHANGES_BELOW_KEY = 'contains_changes';
const PLAIN_ITEMS: ReadonlySet<string> = new Set(['none', 'normal']);

const LOOKS: Record<string, BadgeLook> = {
  conflicted: { icon: 'warning', rank: RANK.attention },
  tree_conflicted: { icon: 'danger-circle', rank: RANK.attention },
  wc_locked: { icon: 'lock', rank: RANK.broken },
  obstructed: { icon: 'transfer', rank: RANK.broken },
  missing: { icon: 'forbidden', rank: RANK.broken },
  incomplete: { icon: 'restart', rank: RANK.broken },
  replaced: { icon: 'restart', rank: RANK.change },
  modified: { icon: 'pen-new', rank: RANK.change },
  merged: { icon: 'pen-new', rank: RANK.change },
  added: { icon: 'add', rank: RANK.change },
  deleted: { icon: 'minus', rank: RANK.change },
  [REMOTE_KEY]: { icon: 'download', rank: RANK.remote },
  locked: { icon: 'lock', rank: RANK.locked },
  [CHANGES_BELOW_KEY]: { icon: 'flag', rank: RANK.changesBelow },
  unversioned: { icon: 'question', rank: RANK.unversioned },
  switched: { icon: 'branches', rank: RANK.marker },
  copied: { icon: 'copy', rank: RANK.marker },
  external: { icon: 'external', rank: RANK.marker },
  ignored: { icon: 'eye-closed', rank: RANK.ignored },
  normal: { icon: 'check', rank: RANK.normal },
};

const FALLBACK_LOOK: BadgeLook = { icon: 'question', rank: RANK.marker };

const REMOTE_LABELS: Record<string, string> = {
  modified: 'Modificado en el servidor',
  added: 'Agregado en el servidor',
  deleted: 'Eliminado en el servidor',
  replaced: 'Reemplazado en el servidor',
};
const REMOTE_FALLBACK_LABEL = 'Cambiado en el servidor';
const CHANGES_BELOW_LABEL = 'Contiene cambios';

const byRank = (first: StateBadge, second: StateBadge) =>
  first.rank - second.rank;

function makeBadge(key: string, label: string, tone: Tone): StateBadge {
  return { key, label, tone, ...(LOOKS[key] ?? FALLBACK_LOOK) };
}

export function localBadge(key: string): StateBadge {
  const { label, tone } = itemLabel(key);
  return makeBadge(key, label, tone);
}

function remoteBadge(item: string): StateBadge {
  const label = REMOTE_LABELS[item] ?? REMOTE_FALLBACK_LABEL;
  return makeBadge(REMOTE_KEY, label, 'warning');
}

function remoteChange(entry: StatusEntry): string | null {
  const changes = [entry.remote_item, entry.remote_props];
  return changes.find((item) => item && !PLAIN_ITEMS.has(item)) ?? null;
}

export const NORMAL_BADGE = localBadge('normal');
export const CHANGES_BELOW_BADGE = makeBadge(
  CHANGES_BELOW_KEY,
  CHANGES_BELOW_LABEL,
  'warning',
);

export function entryBadges(entry: StatusEntry): StateBadge[] {
  const remote = remoteChange(entry);
  const badges = entryStates(entry).map(localBadge);
  if (remote) badges.push(remoteBadge(remote));
  return badges.sort(byRank);
}

export const changeBadges = (badges: readonly StateBadge[]): StateBadge[] =>
  badges.filter((badge) => badge.key !== NORMAL_BADGE.key);

export function sortedBadges(badges: StateBadge[]): StateBadge[] {
  return badges.length === 0 ? [NORMAL_BADGE] : [...badges].sort(byRank);
}

export function badgesRank(badges: readonly StateBadge[]): number {
  return badges[0]?.rank ?? NORMAL_BADGE.rank;
}
