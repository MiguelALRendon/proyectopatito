import { describe, expect, it } from 'vitest';
import type { WcStatusMap } from '../services/filesApi';
import type { StatusEntry } from '../services/tauri';
import { badgesAt, buildStatusIndex } from './statusIndex';

function status(path: string, extra: Partial<StatusEntry> = {}): StatusEntry {
  return {
    path,
    item: 'modified',
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

function indexOf(entries: StatusEntry[], changed_folders: string[] = []) {
  const map: WcStatusMap = {
    entries,
    changed_folders,
    truncated: false,
    against_revision: null,
  };
  return buildStatusIndex(map);
}

const keysAt = (
  index: ReturnType<typeof indexOf>,
  path: string,
  isFolder = false,
) => badgesAt(index, path, isFolder).map((badge) => badge.key);

describe('looking up a path', () => {
  it('ignores case and the kind of separator', () => {
    const index = indexOf([status('WC\\Sub\\A.txt')]);
    expect(keysAt(index, 'wc/sub/a.TXT')).toEqual(['modified']);
    expect(keysAt(index, '\\wc\\sub\\a.txt\\')).toEqual(['modified']);
  });

  it('reports no change for a path the map does not mention', () => {
    const index = indexOf([status('wc\\a.txt')]);
    expect(keysAt(index, 'wc\\b.txt')).toEqual(['normal']);
  });

  it('does not match a sibling that only shares a prefix', () => {
    const index = indexOf([status('wc\\a', { item: 'unversioned' })]);
    expect(keysAt(index, 'wc\\a.txt')).toEqual(['normal']);
    expect(keysAt(index, 'wc\\ab\\x')).toEqual(['normal']);
  });
});

describe('what a path inherits from the folder above', () => {
  it('shows files inside an unversioned or ignored folder as unversioned or ignored', () => {
    const index = indexOf([
      status('wc\\nuevo', { item: 'unversioned' }),
      status('wc\\tmp', { item: 'ignored' }),
    ]);
    expect(keysAt(index, 'wc\\nuevo\\a\\b.txt')).toEqual(['unversioned']);
    expect(keysAt(index, 'wc\\tmp\\x.o')).toEqual(['ignored']);
  });

  it('does not pass a modified or deleted folder state to its children', () => {
    const index = indexOf([
      status('wc\\dir', { item: 'deleted' }),
      status('wc\\prop', { item: 'normal', props: 'modified' }),
    ]);
    expect(keysAt(index, 'wc\\dir\\a.txt')).toEqual(['normal']);
    expect(keysAt(index, 'wc\\prop\\a.txt')).toEqual(['normal']);
  });

  it('uses the nearest folder that has an entry', () => {
    const index = indexOf([
      status('wc\\a', { item: 'unversioned' }),
      status('wc\\a\\b', { item: 'deleted' }),
    ]);
    expect(keysAt(index, 'wc\\a\\b\\c.txt')).toEqual(['normal']);
  });

  it('never looks above the root', () => {
    expect(keysAt(indexOf([]), '')).toEqual(['normal']);
  });
});

describe('folders with changes', () => {
  it('flags only folders, and keeps their own state first', () => {
    const index = indexOf(
      [status('wc\\src', { item: 'conflicted' })],
      ['wc\\src'],
    );
    expect(keysAt(index, 'wc\\src', true)).toEqual([
      'conflicted',
      'contains_changes',
    ]);
    expect(keysAt(index, 'wc\\src', false)).toEqual(['conflicted']);
  });

  it('flags a folder that has changes below and no state of its own', () => {
    const index = indexOf([status('wc\\a\\b.txt')], ['wc', 'wc\\a']);
    expect(keysAt(index, 'WC\\A', true)).toEqual(['contains_changes']);
    expect(keysAt(index, 'wc\\otra', true)).toEqual(['normal']);
  });
});
