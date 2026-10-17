import { computed, ref, type Ref } from 'vue';

export const MIDDLE_BUTTON = 1;

const KEY_ENTER = 'Enter';
const KEY_SPACE = ' ';
const KEY_SELECT_ALL = 'a';
const FIRST_ITEM = 0;
const NO_ITEM = -1;
const SINGLE_COLUMN = 1;

export interface SelectionOptions {
  items: () => string[];
  selected: Ref<string[]>;
  columns: () => number;
  open: (key: string, inNewTab: boolean) => void;
  focusItem: (key: string) => void;
}

export interface Layout {
  count: number;
  columns: number;
}

type Step = (index: number, layout: Layout) => number | null;

const clampIndex = (index: number, layout: Layout) =>
  Math.min(Math.max(index, FIRST_ITEM), layout.count - 1);

const horizontal =
  (delta: number): Step =>
  (index, { count, columns }) =>
    columns > SINGLE_COLUMN
      ? clampIndex(index + delta, { count, columns })
      : null;

const STEPS: Record<string, Step> = {
  ArrowDown: (index, layout) => clampIndex(index + layout.columns, layout),
  ArrowUp: (index, layout) => clampIndex(index - layout.columns, layout),
  ArrowRight: horizontal(1),
  ArrowLeft: horizontal(-1),
  Home: () => FIRST_ITEM,
  End: (_index, layout) => layout.count - 1,
};

export function navigationTarget(
  key: string,
  index: number,
  layout: Layout,
): number | null {
  const step = STEPS[key];
  if (!step || layout.count === 0) return null;
  if (index === NO_ITEM) return FIRST_ITEM;
  return step(index, layout);
}

function rangeBetween(items: string[], from: string | null, to: string) {
  const start = items.indexOf(from ?? to);
  const end = items.indexOf(to);
  if (start < 0 || end < 0) return [to];
  return items.slice(Math.min(start, end), Math.max(start, end) + 1);
}

export function useItemFocus() {
  const elements = new Map<string, HTMLElement>();

  function setItem(key: string, element: unknown) {
    if (element instanceof HTMLElement) elements.set(key, element);
    else elements.delete(key);
  }

  function focusItem(key: string) {
    const element = elements.get(key);
    element?.focus();
    element?.scrollIntoView?.({ block: 'nearest' });
  }

  return { setItem, focusItem };
}

export function useSelection(options: SelectionOptions) {
  const focused = ref<string | null>(null);
  let anchor: string | null = null;

  const isSelected = (key: string) => options.selected.value.includes(key);

  const rovingKey = computed(() => {
    const items = options.items();
    const candidates = [focused.value, options.selected.value[0], items[0]];
    return candidates.find((key) => key != null && items.includes(key)) ?? null;
  });

  function moveFocus(key: string) {
    focused.value = key;
    options.focusItem(key);
  }

  function selectOnly(key: string) {
    options.selected.value = [key];
    anchor = key;
    moveFocus(key);
  }

  function toggle(key: string) {
    const others = options.selected.value.filter((item) => item !== key);
    options.selected.value = isSelected(key) ? others : [...others, key];
    anchor = key;
    moveFocus(key);
  }

  function extendTo(key: string, isAdditive: boolean) {
    const range = rangeBetween(options.items(), anchor, key);
    const kept = isAdditive ? options.selected.value : [];
    options.selected.value = [...new Set([...kept, ...range])];
    moveFocus(key);
  }

  function selectAll() {
    const items = options.items();
    options.selected.value = [...items];
    anchor = items[FIRST_ITEM] ?? null;
  }

  function onClick(event: MouseEvent, key: string) {
    const isAdditive = event.ctrlKey || event.metaKey;
    if (event.shiftKey) extendTo(key, isAdditive);
    else if (isAdditive) toggle(key);
    else selectOnly(key);
  }

  function runAction(event: KeyboardEvent, key: string): boolean {
    const isSelectAll =
      event.ctrlKey && event.key.toLowerCase() === KEY_SELECT_ALL;
    if (event.key === KEY_ENTER) options.open(key, event.ctrlKey);
    else if (event.key === KEY_SPACE)
      (event.ctrlKey ? toggle : selectOnly)(key);
    else if (isSelectAll) selectAll();
    else return false;
    return true;
  }

  function moveTo(event: KeyboardEvent, key: string) {
    if (event.shiftKey) extendTo(key, false);
    else if (event.ctrlKey) moveFocus(key);
    else selectOnly(key);
  }

  function onKeydown(event: KeyboardEvent, key: string) {
    const items = options.items();
    if (runAction(event, key)) return event.preventDefault();
    const layout = { count: items.length, columns: options.columns() };
    const target = navigationTarget(event.key, items.indexOf(key), layout);
    if (target === null) return;
    event.preventDefault();
    moveTo(event, items[target]);
  }

  function onAuxClick(event: MouseEvent, key: string) {
    if (event.button !== MIDDLE_BUTTON) return;
    event.preventDefault();
    options.open(key, true);
  }

  return {
    focused,
    rovingKey,
    isSelected,
    onClick,
    onKeydown,
    onAuxClick,
    onOpen: (event: MouseEvent, key: string) =>
      options.open(key, event.ctrlKey || event.metaKey),
    onFocus: (key: string) => {
      focused.value = key;
    },
  };
}
