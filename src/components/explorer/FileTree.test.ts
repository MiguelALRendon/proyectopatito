import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import FileTree from './FileTree.vue';

const TREE: Record<string, string[]> = {
  '': ['alfa', 'beta', 'vacia'],
  alfa: ['uno', 'dos'],
  'alfa\\uno': [],
  beta: ['x'],
  vacia: [],
};

const load = vi.fn<(path: string) => Promise<string[]>>();

let wrapper: VueWrapper;

async function mountTree(props: Record<string, unknown> = {}) {
  wrapper = mount(FileTree, {
    props: { rootLabel: 'Mis archivos', current: '', load, ...props },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const items = () => wrapper.findAll('[role="treeitem"]');
const item = (name: string) =>
  items().find(
    (candidate) => candidate.find('.file-tree__name').text() === name,
  )!;
const names = () => items().map((row) => row.find('.file-tree__name').text());
const chevron = (name: string) => item(name).get('.file-tree__chevron');

beforeEach(() => {
  load.mockReset();
  load.mockImplementation(async (path) => TREE[path] ?? []);
});

afterEach(() => wrapper.unmount());

describe('FileTree loading', () => {
  it('loads only the root at first', async () => {
    await mountTree();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('');
    expect(names()).toEqual(['Mis archivos', 'alfa', 'beta', 'vacia']);
  });

  it('loads the children of a folder only when it is expanded', async () => {
    await mountTree();
    await chevron('alfa').trigger('click');
    await flushPromises();
    expect(load).toHaveBeenLastCalledWith('alfa');
    expect(names()).toEqual([
      'Mis archivos',
      'alfa',
      'uno',
      'dos',
      'beta',
      'vacia',
    ]);
    expect(load).not.toHaveBeenCalledWith('beta');
  });

  it('collapses without asking again and asks again when it is opened again', async () => {
    await mountTree();
    await chevron('alfa').trigger('click');
    await flushPromises();
    await chevron('alfa').trigger('click');
    expect(names()).toEqual(['Mis archivos', 'alfa', 'beta', 'vacia']);
    expect(load).toHaveBeenCalledTimes(2);
    await chevron('alfa').trigger('click');
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('shows a folder that could not be read and lets the user try again', async () => {
    await mountTree();
    load.mockRejectedValueOnce(new Error('sin permiso'));
    await chevron('beta').trigger('click');
    await flushPromises();
    expect(item('beta').attributes('aria-label')).toBe('beta, no se pudo leer');
    expect(names()).not.toContain('x');
    await chevron('beta').trigger('click');
    await chevron('beta').trigger('click');
    await flushPromises();
    expect(names()).toContain('x');
    expect(item('beta').attributes('aria-label')).toBeUndefined();
  });

  it('keeps the rest of the tree usable when the root cannot be read', async () => {
    load.mockRejectedValueOnce(new Error('x'));
    await mountTree();
    expect(names()).toEqual(['Mis archivos']);
    expect(item('Mis archivos').attributes('aria-label')).toContain(
      'no se pudo leer',
    );
  });

  it('discards a slow answer that was overtaken by a newer one', async () => {
    await mountTree();
    let slow: (value: string[]) => void = () => undefined;
    load.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        slow = resolve;
      }),
    );
    await chevron('beta').trigger('click');
    await chevron('beta').trigger('click');
    await chevron('beta').trigger('click');
    await flushPromises();
    expect(names()).toContain('x');
    slow(['viejo']);
    await flushPromises();
    expect(names()).toContain('x');
    expect(names()).not.toContain('viejo');
  });
});

describe('FileTree refresh', () => {
  it('shows a folder created after the first load without collapsing anything', async () => {
    await mountTree({ refreshKey: 0 });
    await chevron('alfa').trigger('click');
    await flushPromises();
    load.mockImplementation(async (path) =>
      path === '' ? [...TREE[''], 'nueva'] : (TREE[path] ?? []),
    );
    await wrapper.setProps({ refreshKey: 1 });
    await flushPromises();
    expect(names()).toContain('nueva');
    expect(names()).toContain('uno');
    expect(item('alfa').attributes('aria-expanded')).toBe('true');
  });

  it('reads again the root and the expanded folders, not the collapsed ones', async () => {
    await mountTree({ refreshKey: 0 });
    await chevron('alfa').trigger('click');
    await flushPromises();
    load.mockClear();
    await wrapper.setProps({ refreshKey: 1 });
    await flushPromises();
    expect(load.mock.calls.map(([path]) => path).sort()).toEqual(['', 'alfa']);
  });

  it('shows the new children of an expanded folder', async () => {
    await mountTree({ refreshKey: 0 });
    await chevron('alfa').trigger('click');
    await flushPromises();
    load.mockImplementation(async (path) =>
      path === 'alfa' ? ['uno', 'dos', 'tres'] : (TREE[path] ?? []),
    );
    await wrapper.setProps({ refreshKey: 1 });
    await flushPromises();
    expect(names()).toContain('tres');
  });

  it('does nothing while the key does not change', async () => {
    await mountTree({ refreshKey: 3 });
    load.mockClear();
    await wrapper.setProps({ refreshKey: 3 });
    await flushPromises();
    expect(load).not.toHaveBeenCalled();
  });

  it('discards a slow answer overtaken by the refresh', async () => {
    await mountTree({ refreshKey: 0 });
    let slow: (value: string[]) => void = () => undefined;
    load.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        slow = resolve;
      }),
    );
    await chevron('beta').trigger('click');
    await wrapper.setProps({ refreshKey: 1 });
    await flushPromises();
    slow(['viejo']);
    await flushPromises();
    expect(names()).toContain('x');
    expect(names()).not.toContain('viejo');
  });

  it('keeps the previous children and flags the root when its refresh fails', async () => {
    await mountTree({ refreshKey: 0 });
    load.mockRejectedValueOnce(new Error('sin permiso'));
    await wrapper.setProps({ refreshKey: 1 });
    await flushPromises();
    expect(names()).toContain('alfa');
    expect(item('Mis archivos').attributes('aria-label')).toBe(
      'Mis archivos, no se pudo leer',
    );
  });
});

describe('FileTree semantics', () => {
  it('is a tree of treeitems with level, size and position', async () => {
    await mountTree();
    await chevron('alfa').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="tree"]').attributes('aria-label')).toBe(
      'Árbol de carpetas',
    );
    expect(item('Mis archivos').attributes('aria-level')).toBe('1');
    expect(item('uno').attributes()).toMatchObject({
      'aria-level': '3',
      'aria-setsize': '2',
      'aria-posinset': '1',
    });
    expect(item('dos').attributes('aria-posinset')).toBe('2');
  });

  it('reports expanded and collapsed, and nothing for a folder without subfolders', async () => {
    await mountTree();
    await chevron('alfa').trigger('click');
    await flushPromises();
    await chevron('vacia').trigger('click');
    await flushPromises();
    expect(item('alfa').attributes('aria-expanded')).toBe('true');
    expect(item('beta').attributes('aria-expanded')).toBe('false');
    expect(item('vacia').attributes('aria-expanded')).toBeUndefined();
  });

  it('marks the current folder as selected, ignoring case and separators', async () => {
    await mountTree({ current: 'ALFA/' });
    const selected = items().filter(
      (row) => row.attributes('aria-selected') === 'true',
    );
    expect(selected.map((row) => row.find('.file-tree__name').text())).toEqual([
      'alfa',
    ]);
  });

  it('keeps exactly one row in the tab order', async () => {
    await mountTree();
    const tabbable = items().filter(
      (row) => row.attributes('tabindex') === '0',
    );
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].find('.file-tree__name').text()).toBe('Mis archivos');
  });

  it('says in the name of a folder that it contains changes', async () => {
    await mountTree({ changedFolders: new Set(['alfa']) });
    expect(item('alfa').attributes('aria-label')).toBe(
      'alfa, contiene cambios',
    );
    expect(item('beta').attributes('aria-label')).toBeUndefined();
  });

  it('hides the arrows and the folder icon from assistive technology', async () => {
    await mountTree();
    expect(chevron('alfa').attributes('aria-hidden')).toBe('true');
    expect(item('alfa').get('svg').attributes('aria-hidden')).toBe('true');
  });
});

describe('FileTree keyboard', () => {
  const press = (name: string, key: string, extra: object = {}) =>
    item(name).trigger('keydown', { key, ...extra });
  const focused = () =>
    document.activeElement?.querySelector('.file-tree__name')?.textContent;

  it('moves the focus with the down and up arrows', async () => {
    await mountTree();
    await press('Mis archivos', 'ArrowDown');
    expect(focused()).toBe('alfa');
    await press('alfa', 'ArrowUp');
    expect(focused()).toBe('Mis archivos');
  });

  it('jumps to the first and last visible row', async () => {
    await mountTree();
    await press('Mis archivos', 'End');
    expect(focused()).toBe('vacia');
    await press('vacia', 'Home');
    expect(focused()).toBe('Mis archivos');
  });

  it('expands with the right arrow, then enters the first child', async () => {
    await mountTree();
    await press('alfa', 'ArrowRight');
    await flushPromises();
    expect(item('alfa').attributes('aria-expanded')).toBe('true');
    await press('alfa', 'ArrowRight');
    expect(focused()).toBe('uno');
  });

  it('collapses with the left arrow, then goes to the parent', async () => {
    await mountTree();
    await press('alfa', 'ArrowRight');
    await flushPromises();
    await press('uno', 'ArrowLeft');
    expect(focused()).toBe('alfa');
    await press('alfa', 'ArrowLeft');
    expect(item('alfa').attributes('aria-expanded')).toBe('false');
  });

  it('does nothing harmful with the right arrow on a known leaf or with other keys', async () => {
    await mountTree();
    await chevron('vacia').trigger('click');
    await flushPromises();
    load.mockClear();
    await press('vacia', 'ArrowRight');
    await press('alfa', 'Delete');
    await press('alfa', 'a');
    expect(load).not.toHaveBeenCalled();
    expect(wrapper.emitted('open')).toBeUndefined();
  });

  it('opens the folder with Enter and Space, in a new tab with Ctrl', async () => {
    await mountTree();
    await press('alfa', 'Enter');
    await press('beta', ' ');
    await press('beta', 'Enter', { ctrlKey: true });
    expect(wrapper.emitted('open')).toEqual([
      ['alfa', false],
      ['beta', false],
      ['beta', true],
    ]);
  });

  it('prevents the page from scrolling on the keys it handles', async () => {
    await mountTree();
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      cancelable: true,
      bubbles: true,
    });
    item('alfa').element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const other = new KeyboardEvent('keydown', {
      key: 'q',
      cancelable: true,
      bubbles: true,
    });
    item('alfa').element.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });
});

describe('FileTree mouse', () => {
  it('opens a folder on click and expands it', async () => {
    await mountTree();
    await item('alfa').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('open')).toEqual([['alfa', false]]);
    expect(item('alfa').attributes('aria-expanded')).toBe('true');
  });

  it('does not collapse a folder that is clicked again', async () => {
    await mountTree();
    await item('alfa').trigger('click');
    await flushPromises();
    await item('alfa').trigger('click');
    expect(item('alfa').attributes('aria-expanded')).toBe('true');
    expect(wrapper.emitted('open')).toHaveLength(2);
  });

  it('opens in a new tab with Ctrl+click and with the middle button', async () => {
    await mountTree();
    await item('beta').trigger('click', { ctrlKey: true });
    await item('alfa').trigger('auxclick', { button: 1 });
    expect(wrapper.emitted('open')).toEqual([
      ['beta', true],
      ['alfa', true],
    ]);
  });

  it('ignores other auxiliary buttons', async () => {
    await mountTree();
    await item('alfa').trigger('auxclick', { button: 2 });
    expect(wrapper.emitted('open')).toBeUndefined();
  });

  it('only toggles when the arrow is clicked, without opening the folder', async () => {
    await mountTree();
    await chevron('alfa').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('open')).toBeUndefined();
    expect(item('alfa').attributes('aria-expanded')).toBe('true');
  });
});

describe('FileTree happy path', () => {
  it('walks down two levels with the keyboard and opens the deepest folder', async () => {
    await mountTree();
    await item('alfa').trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    await item('alfa').trigger('keydown', { key: 'ArrowRight' });
    await item('uno').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('open')).toEqual([['alfa\\uno', false]]);
  });
});
