import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { navigationTarget, useItemFocus, useSelection } from './useSelection';

const ITEMS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

function setup(items: string[] = ITEMS, columns = 1) {
  const selected = ref<string[]>([]);
  const open = vi.fn();
  const focusItem = vi.fn();
  const current = ref(items);
  const selection = useSelection({
    items: () => current.value,
    selected,
    columns: () => columns,
    open,
    focusItem,
  });
  return { selected, open, focusItem, selection, current };
}

function key(name: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', {
    key: name,
    cancelable: true,
    ...init,
  });
}

function click(init: MouseEventInit = {}) {
  return new MouseEvent('click', init);
}

describe('navigationTarget', () => {
  const layout = { count: 7, columns: 1 };

  it('handles nothing when the list is empty or the key is not a movement', () => {
    expect(
      navigationTarget('ArrowDown', 0, { count: 0, columns: 1 }),
    ).toBeNull();
    expect(navigationTarget('Delete', 2, layout)).toBeNull();
    expect(navigationTarget('x', 2, layout)).toBeNull();
    expect(navigationTarget('', 2, layout)).toBeNull();
  });

  it('clamps at both ends instead of wrapping', () => {
    expect(navigationTarget('ArrowUp', 0, layout)).toBe(0);
    expect(navigationTarget('ArrowDown', 6, layout)).toBe(6);
  });

  it('ignores left and right in a single column', () => {
    expect(navigationTarget('ArrowLeft', 3, layout)).toBeNull();
    expect(navigationTarget('ArrowRight', 3, layout)).toBeNull();
  });

  it('moves by whole rows and by cells in a multi-column grid', () => {
    const grid = { count: 7, columns: 3 };
    expect(navigationTarget('ArrowDown', 1, grid)).toBe(4);
    expect(navigationTarget('ArrowDown', 5, grid)).toBe(6);
    expect(navigationTarget('ArrowUp', 4, grid)).toBe(1);
    expect(navigationTarget('ArrowRight', 2, grid)).toBe(3);
    expect(navigationTarget('ArrowLeft', 0, grid)).toBe(0);
  });

  it('jumps to the first and last item', () => {
    expect(navigationTarget('Home', 4, layout)).toBe(0);
    expect(navigationTarget('End', 1, layout)).toBe(6);
  });

  it('starts at the first item when nothing has focus yet', () => {
    expect(navigationTarget('ArrowDown', -1, layout)).toBe(0);
    expect(navigationTarget('End', -1, layout)).toBe(0);
  });
});

describe('Delete', () => {
  it('does nothing: no selection change, no open, not even prevented', () => {
    const { selected, open, selection } = setup();
    selected.value = ['b', 'c'];
    const event = key('Delete');
    selection.onKeydown(event, 'b');
    expect(selected.value).toEqual(['b', 'c']);
    expect(open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('stays inert with modifiers too', () => {
    const { selected, open, selection } = setup();
    selected.value = ['a'];
    selection.onKeydown(key('Delete', { ctrlKey: true, shiftKey: true }), 'a');
    selection.onKeydown(key('Backspace'), 'a');
    expect(selected.value).toEqual(['a']);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('mouse selection', () => {
  it('shift-click without an anchor selects only the clicked item', () => {
    const { selected, selection } = setup();
    selection.onClick(click({ shiftKey: true }), 'c');
    expect(selected.value).toEqual(['c']);
  });

  it('ignores a click on an item that is not in the list when extending', () => {
    const { selected, selection } = setup();
    selection.onClick(click(), 'b');
    selection.onClick(click({ shiftKey: true }), 'fantasma');
    expect(selected.value).toEqual(['fantasma']);
  });

  it('ctrl-click toggles an item on and off without touching the others', () => {
    const { selected, selection } = setup();
    selection.onClick(click(), 'a');
    selection.onClick(click({ ctrlKey: true }), 'c');
    expect(selected.value).toEqual(['a', 'c']);
    selection.onClick(click({ ctrlKey: true }), 'a');
    expect(selected.value).toEqual(['c']);
  });

  it('shift-click selects the range from the anchor in either direction', () => {
    const { selected, selection } = setup();
    selection.onClick(click(), 'c');
    selection.onClick(click({ shiftKey: true }), 'e');
    expect(selected.value).toEqual(['c', 'd', 'e']);
    selection.onClick(click({ shiftKey: true }), 'a');
    expect(selected.value).toEqual(['a', 'b', 'c']);
  });

  it('ctrl+shift-click adds the range to what was already selected', () => {
    const { selected, selection } = setup();
    selection.onClick(click(), 'a');
    selection.onClick(click({ ctrlKey: true }), 'e');
    selection.onClick(click({ ctrlKey: true, shiftKey: true }), 'g');
    expect(selected.value).toEqual(['a', 'e', 'f', 'g']);
  });

  it('a plain click replaces a multiple selection', () => {
    const { selected, selection } = setup();
    selection.onClick(click(), 'a');
    selection.onClick(click({ shiftKey: true }), 'd');
    selection.onClick(click(), 'f');
    expect(selected.value).toEqual(['f']);
  });
});

describe('keyboard selection', () => {
  it('moves the selection with the arrows and focuses the target', () => {
    const { selected, focusItem, selection } = setup();
    selection.onKeydown(key('ArrowDown'), 'a');
    expect(selected.value).toEqual(['b']);
    expect(focusItem).toHaveBeenLastCalledWith('b');
    selection.onKeydown(key('ArrowUp'), 'b');
    selection.onKeydown(key('ArrowUp'), 'a');
    expect(selected.value).toEqual(['a']);
  });

  it('prevents the default of a handled key so the page does not scroll', () => {
    const { selection } = setup();
    const handled = key('ArrowDown');
    selection.onKeydown(handled, 'a');
    expect(handled.defaultPrevented).toBe(true);
    const ignored = key('ArrowRight');
    selection.onKeydown(ignored, 'a');
    expect(ignored.defaultPrevented).toBe(false);
  });

  it('shift+arrow extends from the anchor and shrinks when going back', () => {
    const { selected, selection } = setup();
    selection.onClick(click(), 'b');
    selection.onKeydown(key('ArrowDown', { shiftKey: true }), 'b');
    selection.onKeydown(key('ArrowDown', { shiftKey: true }), 'c');
    expect(selected.value).toEqual(['b', 'c', 'd']);
    selection.onKeydown(key('ArrowUp', { shiftKey: true }), 'd');
    expect(selected.value).toEqual(['b', 'c']);
  });

  it('ctrl+arrow moves the focus and keeps the selection', () => {
    const { selected, focusItem, selection } = setup();
    selection.onClick(click(), 'a');
    selection.onKeydown(key('ArrowDown', { ctrlKey: true }), 'a');
    expect(selected.value).toEqual(['a']);
    expect(focusItem).toHaveBeenLastCalledWith('b');
  });

  it('home and end select the first and last item; shift extends to them', () => {
    const { selected, selection } = setup();
    selection.onKeydown(key('End'), 'c');
    expect(selected.value).toEqual(['g']);
    selection.onKeydown(key('Home', { shiftKey: true }), 'g');
    expect(selected.value).toEqual(ITEMS);
  });

  it('moves by rows in a grid with several columns', () => {
    const { selected, selection } = setup(ITEMS, 3);
    selection.onKeydown(key('ArrowDown'), 'b');
    expect(selected.value).toEqual(['e']);
    selection.onKeydown(key('ArrowRight'), 'e');
    expect(selected.value).toEqual(['f']);
  });

  it('ctrl+A selects everything and does nothing on an empty list', () => {
    const { selected, selection } = setup();
    selection.onKeydown(key('a', { ctrlKey: true }), 'a');
    expect(selected.value).toEqual(ITEMS);
    const empty = setup([]);
    empty.selection.onKeydown(key('a', { ctrlKey: true }), 'a');
    expect(empty.selected.value).toEqual([]);
  });

  it('space selects the item and ctrl+space toggles it', () => {
    const { selected, selection } = setup();
    selection.onKeydown(key(' '), 'b');
    expect(selected.value).toEqual(['b']);
    selection.onKeydown(key(' ', { ctrlKey: true }), 'c');
    expect(selected.value).toEqual(['b', 'c']);
    selection.onKeydown(key(' ', { ctrlKey: true }), 'b');
    expect(selected.value).toEqual(['c']);
  });
});

describe('opening', () => {
  it('Enter opens the focused item and ctrl+Enter asks for a new tab', () => {
    const { open, selection } = setup();
    selection.onKeydown(key('Enter'), 'c');
    expect(open).toHaveBeenLastCalledWith('c', false);
    selection.onKeydown(key('Enter', { ctrlKey: true }), 'd');
    expect(open).toHaveBeenLastCalledWith('d', true);
  });

  it('double click opens and ctrl+double click opens in a new tab', () => {
    const { open, selection } = setup();
    selection.onOpen(new MouseEvent('dblclick'), 'a');
    expect(open).toHaveBeenLastCalledWith('a', false);
    selection.onOpen(new MouseEvent('dblclick', { ctrlKey: true }), 'a');
    expect(open).toHaveBeenLastCalledWith('a', true);
  });

  it('only the middle button opens in a new tab', () => {
    const { open, selection } = setup();
    const right = new MouseEvent('auxclick', { button: 2, cancelable: true });
    selection.onAuxClick(right, 'a');
    expect(open).not.toHaveBeenCalled();
    const middle = new MouseEvent('auxclick', { button: 1, cancelable: true });
    selection.onAuxClick(middle, 'a');
    expect(open).toHaveBeenCalledWith('a', true);
    expect(middle.defaultPrevented).toBe(true);
  });
});

describe('roving focus', () => {
  it('falls back to the first selected item and then to the first item', () => {
    const { selected, selection } = setup();
    expect(selection.rovingKey.value).toBe('a');
    selected.value = ['d'];
    expect(selection.rovingKey.value).toBe('d');
    selection.onFocus('f');
    expect(selection.rovingKey.value).toBe('f');
  });

  it('drops a focused item that left the list', () => {
    const { current, selection } = setup();
    selection.onFocus('g');
    current.value = ['a', 'b'];
    expect(selection.rovingKey.value).toBe('a');
  });

  it('has no focusable item in an empty list', () => {
    expect(setup([]).selection.rovingKey.value).toBeNull();
  });
});

describe('item focus registry', () => {
  it('focuses a registered element and forgets it when it unmounts', () => {
    const { setItem, focusItem } = useItemFocus();
    const element = document.createElement('div');
    element.tabIndex = 0;
    document.body.append(element);
    setItem('a', element);
    focusItem('a');
    expect(document.activeElement).toBe(element);
    setItem('a', null);
    expect(() => focusItem('a')).not.toThrow();
    element.remove();
  });
});

describe('simple and multiple selection', () => {
  it('selects one item by click and several with the keyboard', () => {
    const { selected, selection } = setup();
    selection.onClick(click(), 'b');
    expect(selected.value).toEqual(['b']);
    selection.onKeydown(key('ArrowDown', { shiftKey: true }), 'b');
    selection.onKeydown(key('ArrowDown', { shiftKey: true }), 'c');
    expect(selected.value).toEqual(['b', 'c', 'd']);
    expect(selection.isSelected('c')).toBe(true);
    expect(selection.isSelected('e')).toBe(false);
  });
});
