import { describe, expect, it } from 'vitest';
import {
  flattenTree,
  treeMove,
  type TreeInput,
  type TreeNodeState,
  type TreeRow,
} from './treeRows';

const loaded = (...children: string[]): TreeNodeState => ({
  children,
  isLoading: false,
  hasFailed: false,
});

function input(extra: Partial<TreeInput> = {}): TreeInput {
  return {
    rootLabel: 'Raiz',
    nodes: {},
    expanded: new Set(),
    changed: new Set(),
    ...extra,
  };
}

const OPEN: TreeInput = input({
  nodes: { '': loaded('a', 'b'), a: loaded('x', 'y'), b: loaded() },
  expanded: new Set(['', 'a']),
});

const names = (rows: TreeRow[]) => rows.map((row) => row.name);

describe('flattening the tree', () => {
  it('shows only the root while nothing is expanded or loaded', () => {
    const rows = flattenTree(input());
    expect(names(rows)).toEqual(['Raiz']);
    expect(rows[0]).toMatchObject({ level: 1, position: 1, size: 1 });
    expect(rows[0].canExpand).toBe(true);
  });

  it('lists children after their parent, level by level', () => {
    const rows = flattenTree(OPEN);
    expect(names(rows)).toEqual(['Raiz', 'a', 'x', 'y', 'b']);
    expect(rows.map((row) => row.level)).toEqual([1, 2, 3, 3, 2]);
    expect(rows.map((row) => row.path)).toEqual(['', 'a', 'a\\x', 'a\\y', 'b']);
  });

  it('numbers siblings for assistive technology', () => {
    const rows = flattenTree(OPEN);
    const second = rows.find((row) => row.name === 'b');
    expect(second).toMatchObject({ position: 2, size: 2 });
  });

  it('hides the children of a collapsed folder but keeps them loaded', () => {
    const collapsed = input({ ...OPEN, expanded: new Set(['']) });
    expect(names(flattenTree(collapsed))).toEqual(['Raiz', 'a', 'b']);
  });

  it('does not offer to expand a folder known to have no subfolders', () => {
    const rows = flattenTree(OPEN);
    expect(rows.find((row) => row.name === 'b')?.canExpand).toBe(false);
    expect(rows.find((row) => row.name === 'a')?.canExpand).toBe(true);
  });

  it('finds state by path ignoring case', () => {
    const rows = flattenTree(
      input({
        nodes: { '': loaded('A'), a: { ...loaded('x'), hasFailed: true } },
        expanded: new Set(['', 'a']),
        changed: new Set(['a']),
      }),
    );
    expect(rows[1]).toMatchObject({
      name: 'A',
      hasFailed: true,
      hasChanges: true,
    });
  });

  it('keeps a failed or loading node visible and expandable to retry', () => {
    const rows = flattenTree(
      input({
        nodes: { '': { children: null, isLoading: true, hasFailed: false } },
        expanded: new Set(['']),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isLoading: true, canExpand: true });
  });
});

describe('keyboard movement', () => {
  const rows = flattenTree(OPEN);
  const at = (name: string) => rows.findIndex((row) => row.name === name);

  it('moves between visible rows and stops at the edges', () => {
    expect(treeMove('ArrowDown', rows, at('a'))).toEqual({
      kind: 'focus',
      path: 'a\\x',
    });
    expect(treeMove('ArrowUp', rows, 0)).toEqual({ kind: 'focus', path: '' });
    expect(treeMove('ArrowDown', rows, rows.length - 1)).toEqual({
      kind: 'focus',
      path: 'b',
    });
  });

  it('jumps to the first and last row', () => {
    expect(treeMove('Home', rows, 3)).toEqual({ kind: 'focus', path: '' });
    expect(treeMove('End', rows, 0)).toEqual({ kind: 'focus', path: 'b' });
  });

  it('expands a collapsed folder, then enters its first child', () => {
    const closed = flattenTree(input({ ...OPEN, expanded: new Set(['']) }));
    expect(treeMove('ArrowRight', closed, 1)).toEqual({
      kind: 'expand',
      path: 'a',
    });
    expect(treeMove('ArrowRight', rows, at('a'))).toEqual({
      kind: 'focus',
      path: 'a\\x',
    });
  });

  it('does nothing on the right arrow for a leaf folder or an empty expanded one', () => {
    expect(treeMove('ArrowRight', rows, at('b'))).toBeNull();
    const empty = flattenTree(
      input({
        nodes: { '': loaded() },
        expanded: new Set(['']),
      }),
    );
    expect(treeMove('ArrowRight', empty, 0)).toBeNull();
  });

  it('collapses an open folder, then goes to the parent', () => {
    expect(treeMove('ArrowLeft', rows, at('a'))).toEqual({
      kind: 'collapse',
      path: 'a',
    });
    expect(treeMove('ArrowLeft', rows, at('x'))).toEqual({
      kind: 'focus',
      path: 'a',
    });
  });

  it('has no parent to go to from the root', () => {
    const closed = flattenTree(input());
    expect(treeMove('ArrowLeft', closed, 0)).toBeNull();
  });

  it('ignores other keys and rows that do not exist', () => {
    expect(treeMove('x', rows, 0)).toBeNull();
    expect(treeMove('ArrowDown', rows, -1)).toBeNull();
    expect(treeMove('ArrowDown', rows, 99)).toBeNull();
  });
});
