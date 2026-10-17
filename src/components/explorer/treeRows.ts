import { joinPath, pathKey } from '../../utils/folderPaths';

export interface TreeNodeState {
  children: string[] | null;
  isLoading: boolean;
  hasFailed: boolean;
}

export interface TreeRow {
  path: string;
  name: string;
  level: number;
  position: number;
  size: number;
  isExpanded: boolean;
  canExpand: boolean;
  isLoading: boolean;
  hasFailed: boolean;
  hasChanges: boolean;
}

export interface TreeInput {
  rootLabel: string;
  nodes: Readonly<Record<string, TreeNodeState>>;
  expanded: ReadonlySet<string>;
  changed: ReadonlySet<string>;
}

interface RowSpec {
  path: string;
  name: string;
  level: number;
  position: number;
  size: number;
}

export type TreeMove =
  | { kind: 'focus'; path: string }
  | { kind: 'expand'; path: string }
  | { kind: 'collapse'; path: string };

const KEY_DOWN = 'ArrowDown';
const KEY_UP = 'ArrowUp';
const KEY_RIGHT = 'ArrowRight';
const KEY_LEFT = 'ArrowLeft';
const KEY_HOME = 'Home';
const KEY_END = 'End';
const ROOT_LEVEL = 1;

export const nodeKey = pathKey;

function isExpandable(node: TreeNodeState | undefined): boolean {
  return !node?.children || node.children.length > 0;
}

function rowOf(spec: RowSpec, input: TreeInput): TreeRow {
  const key = nodeKey(spec.path);
  const node = input.nodes[key];
  return {
    ...spec,
    isExpanded: input.expanded.has(key),
    canExpand: isExpandable(node),
    isLoading: node?.isLoading ?? false,
    hasFailed: node?.hasFailed ?? false,
    hasChanges: input.changed.has(key),
  };
}

export function flattenTree(input: TreeInput): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (spec: RowSpec) => {
    const row = rowOf(spec, input);
    rows.push(row);
    if (!row.isExpanded) return;
    const names = input.nodes[nodeKey(spec.path)]?.children ?? [];
    names.forEach((name, index) =>
      visit({
        path: joinPath(spec.path, name),
        name,
        level: spec.level + 1,
        position: index + 1,
        size: names.length,
      }),
    );
  };
  visit({
    path: '',
    name: input.rootLabel,
    level: ROOT_LEVEL,
    position: 1,
    size: 1,
  });
  return rows;
}

function parentRow(rows: readonly TreeRow[], index: number): TreeRow | null {
  const level = rows[index].level;
  const before = rows.slice(0, index).reverse();
  return before.find((row) => row.level === level - 1) ?? null;
}

function moveRight(rows: readonly TreeRow[], index: number): TreeMove | null {
  const row = rows[index];
  if (!row.canExpand) return null;
  if (!row.isExpanded) return { kind: 'expand', path: row.path };
  const child = rows[index + 1];
  return child && child.level > row.level
    ? { kind: 'focus', path: child.path }
    : null;
}

function moveLeft(rows: readonly TreeRow[], index: number): TreeMove | null {
  const row = rows[index];
  if (row.isExpanded) return { kind: 'collapse', path: row.path };
  const parent = parentRow(rows, index);
  return parent ? { kind: 'focus', path: parent.path } : null;
}

function focusAt(rows: readonly TreeRow[], index: number): TreeMove {
  const bounded = Math.min(Math.max(index, 0), rows.length - 1);
  return { kind: 'focus', path: rows[bounded].path };
}

export function treeMove(
  key: string,
  rows: readonly TreeRow[],
  index: number,
): TreeMove | null {
  if (index < 0 || index >= rows.length) return null;
  if (key === KEY_DOWN) return focusAt(rows, index + 1);
  if (key === KEY_UP) return focusAt(rows, index - 1);
  if (key === KEY_HOME) return focusAt(rows, 0);
  if (key === KEY_END) return focusAt(rows, rows.length - 1);
  if (key === KEY_RIGHT) return moveRight(rows, index);
  if (key === KEY_LEFT) return moveLeft(rows, index);
  return null;
}
