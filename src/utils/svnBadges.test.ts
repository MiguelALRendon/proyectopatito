import { describe, expect, it } from 'vitest';
import type { StatusEntry } from '../services/tauri';
import {
  CHANGES_BELOW_BADGE,
  NORMAL_BADGE,
  badgesRank,
  changeBadges,
  entryBadges,
  localBadge,
  sortedBadges,
} from './svnBadges';
import { STATE_LEGEND } from './svnLabels';

function status(extra: Partial<StatusEntry> = {}): StatusEntry {
  return {
    path: 'wc\\a.txt',
    item: 'normal',
    props: 'none',
    revision: 1,
    remote_item: null,
    remote_props: null,
    wc_locked: false,
    tree_conflicted: false,
    copied: false,
    switched: false,
    lock: null,
    ...extra,
  };
}

const keys = (entry: StatusEntry) => entryBadges(entry).map((b) => b.key);

describe('badge model against hostile input', () => {
  it('falls back to a visible question mark for a state it does not know', () => {
    const [badge] = entryBadges(status({ item: 'frobnicated' }));
    expect(badge.label).toBe('frobnicated');
    expect(badge.icon).toBe('question');
  });

  it('shows nothing for an entry whose only news is a plain remote state', () => {
    const entry = status({ remote_item: 'normal', remote_props: 'none' });
    expect(entryBadges(entry)).toEqual([]);
  });

  it('never leaves a state without text', () => {
    STATE_LEGEND.forEach(({ key }) => {
      expect(localBadge(key).label.trim()).not.toBe('');
    });
  });

  it('gives no two states the same shape and color together, so color is never the only cue', () => {
    const pairs = STATE_LEGEND.map(({ key }) => localBadge(key)).map(
      (badge) => `${badge.icon}:${badge.tone}`,
    );
    const all = [
      ...pairs,
      `${CHANGES_BELOW_BADGE.icon}:${CHANGES_BELOW_BADGE.tone}`,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('gives no two states the same text', () => {
    const labels = STATE_LEGEND.map(({ key }) => localBadge(key).label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('every state of the fixture gets its own badge', () => {
  it.each([
    ['modified', 'Modificado'],
    ['added', 'Agregado'],
    ['deleted', 'Eliminado'],
    ['replaced', 'Reemplazado'],
    ['conflicted', 'En conflicto'],
    ['unversioned', 'Sin versionar'],
    ['missing', 'Faltante'],
    ['ignored', 'Ignorado'],
    ['external', 'Externo'],
    ['obstructed', 'Tipo cambiado'],
  ])('shows %s as %s', (item, label) => {
    expect(entryBadges(status({ item }))).toEqual([
      expect.objectContaining({ key: item, label }),
    ]);
  });

  it('shows the flags that do not change the item', () => {
    expect(keys(status({ lock: { owner: 'a', comment: null } }))).toEqual([
      'locked',
    ]);
    expect(keys(status({ tree_conflicted: true }))).toEqual([
      'tree_conflicted',
    ]);
    expect(keys(status({ copied: true }))).toEqual(['copied']);
    expect(keys(status({ switched: true }))).toEqual(['switched']);
    expect(keys(status({ wc_locked: true }))).toEqual(['wc_locked']);
  });
});

describe('remote changes', () => {
  it('shows what changed on the server even when the file is untouched locally', () => {
    const [badge] = entryBadges(status({ remote_item: 'modified' }));
    expect(badge).toMatchObject({
      key: 'remote',
      label: 'Modificado en el servidor',
      tone: 'warning',
    });
  });

  it('names added and deleted remote changes and has a generic fallback', () => {
    const label = (remote_item: string) =>
      entryBadges(status({ remote_item }))[0].label;
    expect(label('added')).toBe('Agregado en el servidor');
    expect(label('deleted')).toBe('Eliminado en el servidor');
    expect(label('incoming')).toBe('Cambiado en el servidor');
  });

  it('uses the property change when only properties changed remotely', () => {
    const entry = status({ remote_item: 'none', remote_props: 'modified' });
    expect(entryBadges(entry)[0].label).toBe('Modificado en el servidor');
  });

  it('keeps the local state next to the remote one, most urgent first', () => {
    const entry = status({ item: 'conflicted', remote_item: 'modified' });
    expect(keys(entry)).toEqual(['conflicted', 'remote']);
  });
});

describe('ranking', () => {
  it('puts conflicts before changes, changes before unversioned and ignored last', () => {
    const rank = (item: string) => localBadge(item).rank;
    expect(rank('conflicted')).toBeLessThan(rank('modified'));
    expect(rank('missing')).toBeLessThan(rank('modified'));
    expect(rank('modified')).toBeLessThan(rank('unversioned'));
    expect(rank('unversioned')).toBeLessThan(rank('ignored'));
    expect(rank('ignored')).toBeLessThan(rank('normal'));
  });

  it('ranks a folder with changes below a modified file but above unversioned', () => {
    const rank = CHANGES_BELOW_BADGE.rank;
    expect(rank).toBeGreaterThan(localBadge('modified').rank);
    expect(rank).toBeLessThan(localBadge('unversioned').rank);
  });

  it('takes the rank of the most urgent badge and treats none as normal', () => {
    const urgent = sortedBadges([
      localBadge('ignored'),
      localBadge('conflicted'),
    ]);
    expect(badgesRank(urgent)).toBe(localBadge('conflicted').rank);
    expect(badgesRank([])).toBe(NORMAL_BADGE.rank);
  });

  it('shows the normal badge for an empty list and drops it from change lists', () => {
    expect(sortedBadges([])).toEqual([NORMAL_BADGE]);
    expect(changeBadges([NORMAL_BADGE])).toEqual([]);
    expect(changeBadges([localBadge('added'), NORMAL_BADGE])).toHaveLength(1);
  });
});

describe('badge for a modified file', () => {
  it('has text, a shape and a tone', () => {
    expect(localBadge('modified')).toEqual({
      key: 'modified',
      label: 'Modificado',
      tone: 'warning',
      icon: 'pen-new',
      rank: 2,
    });
  });
});
