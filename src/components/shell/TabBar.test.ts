import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../services/filesApi', () => ({
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
}));
vi.mock('../../composables/useConfirm', () => ({ confirm: vi.fn() }));

import { confirm } from '../../composables/useConfirm';
import { useTabsStore } from '../../stores/tabs';
import AppShell from './AppShell.vue';
import TabBar from './TabBar.vue';

const TAB_WIDTH = 100;

let wrapper: VueWrapper;
let store: ReturnType<typeof useTabsStore>;

function mountBar(paths: string[] = []) {
  setActivePinia(createPinia());
  store = useTabsStore();
  const ids = paths.map((path) => store.open(path) as string);
  wrapper = mount(TabBar, { attachTo: document.body });
  return ids;
}

function tabElements() {
  return wrapper.findAll('[role="tab"]');
}

function tabTitles() {
  return tabElements().map((tab) => tab.text());
}

function tabFor(title: string) {
  return tabElements().find((tab) => tab.text().startsWith(title))!;
}

function focusTab(title: string) {
  (tabFor(title).element as HTMLElement).focus();
}

function layOutTabs() {
  wrapper.findAll('.tab-bar__item').forEach((item, index) => {
    const left = index * TAB_WIDTH;
    vi.spyOn(item.element, 'getBoundingClientRect').mockReturnValue({
      left,
      right: left + TAB_WIDTH,
      top: 0,
      bottom: 30,
    } as DOMRect);
  });
}

function pointer(type: string, clientX: number, button = 0) {
  const event = new MouseEvent(type, { clientX, button, bubbles: true });
  return Object.assign(event, { pointerId: 1 });
}

async function dragTab(title: string, fromX: number, toX: number) {
  const element = tabFor(title).element;
  element.dispatchEvent(pointer('pointerdown', fromX));
  element.dispatchEvent(pointer('pointermove', toX));
  await flushPromises();
  return () => {
    element.dispatchEvent(pointer('pointerup', toX));
    return flushPromises();
  };
}

beforeEach(() => {
  vi.mocked(confirm).mockReset();
});

afterEach(() => {
  wrapper.unmount();
  vi.restoreAllMocks();
});

describe('TabBar semantics', () => {
  it('exposes a labelled tablist with one tab per open tab', () => {
    mountBar(['a', 'b']);
    const list = wrapper.get('[role="tablist"]');
    expect(list.attributes('aria-label')).toBe('Pestañas abiertas');
    expect(tabTitles()).toEqual(['a', 'b']);
  });

  it('marks only the active tab as selected and gives it the only tab stop', () => {
    mountBar(['a', 'b']);
    expect(tabFor('b').attributes('aria-selected')).toBe('true');
    expect(tabFor('a').attributes('aria-selected')).toBe('false');
    expect(tabFor('b').attributes('tabindex')).toBe('0');
    expect(tabFor('a').attributes('tabindex')).toBe('-1');
  });

  it('links the selected tab to the tab panel', () => {
    mountBar(['a', 'b']);
    expect(tabFor('b').attributes('aria-controls')).toBe('tab-panel');
    expect(tabFor('a').attributes('aria-controls')).toBeUndefined();
  });

  it('announces unsaved changes in the accessible name, not only with a dot', () => {
    const [a] = mountBar(['a', 'b']);
    store.setDirty(a, true);
    return flushPromises().then(() => {
      expect(tabFor('a').attributes('aria-label')).toBe(
        'a (cambios sin guardar)',
      );
      expect(tabFor('b').attributes('aria-label')).toBe('b');
    });
  });

  it('renders the live region even when there is nothing to say', () => {
    mountBar([]);
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });

  it('shows an empty-state free list when no tab is open', () => {
    mountBar([]);
    expect(tabElements()).toHaveLength(0);
  });
});

describe('TabBar opening and activating', () => {
  it('opens the workspace root with the plus button and does not duplicate it', async () => {
    mountBar([]);
    const add = wrapper.get('.tab-bar__add');
    await add.trigger('click');
    await add.trigger('click');
    expect(store.tabs).toHaveLength(1);
    expect(tabTitles()).toEqual(['Mis archivos']);
  });

  it('activates the root tab again when it already exists', async () => {
    mountBar(['', 'a']);
    await wrapper.get('.tab-bar__add').trigger('click');
    expect(store.activeTab?.path).toBe('');
    expect(store.tabs).toHaveLength(2);
  });

  it('activates a tab on click', async () => {
    mountBar(['a', 'b']);
    await tabFor('a').trigger('click');
    expect(store.activeTab?.path).toBe('a');
  });

  it('disables the plus button while the session is being restored', async () => {
    mountBar([]);
    store.isRestoring = true;
    await flushPromises();
    expect(wrapper.get('.tab-bar__add').attributes('disabled')).toBeDefined();
    store.isRestoring = false;
    await flushPromises();
    expect(wrapper.get('.tab-bar__add').attributes('disabled')).toBeUndefined();
  });

  it('labels the plus button for assistive technology', () => {
    mountBar([]);
    expect(wrapper.get('.tab-bar__add').attributes('aria-label')).toBe(
      'Abrir Mis archivos en una pestaña',
    );
  });
});

describe('TabBar closing', () => {
  it('closes with the close button without activating the tab first', async () => {
    mountBar(['a', 'b']);
    await wrapper.findAll('.tab-bar__close')[0].trigger('click');
    expect(tabTitles()).toEqual(['b']);
  });

  it('closes with a middle click', async () => {
    mountBar(['a', 'b']);
    await tabFor('a').trigger('auxclick', { button: 1 });
    await flushPromises();
    expect(tabTitles()).toEqual(['b']);
  });

  it('ignores the right button on auxclick', async () => {
    mountBar(['a', 'b']);
    await tabFor('a').trigger('auxclick', { button: 2 });
    expect(tabTitles()).toEqual(['a', 'b']);
  });

  it('prevents the middle-button autoscroll', async () => {
    mountBar(['a']);
    const event = new MouseEvent('mousedown', {
      button: 1,
      bubbles: true,
      cancelable: true,
    });
    tabFor('a').element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('closes the focused tab with Delete and focuses the new active tab', async () => {
    mountBar(['a', 'b']);
    focusTab('b');
    await tabFor('b').trigger('keydown', { key: 'Delete' });
    await flushPromises();
    expect(tabTitles()).toEqual(['a']);
    expect(document.activeElement).toBe(tabFor('a').element);
  });

  it('keeps a dirty tab and focus on it when the user cancels the confirmation', async () => {
    const [a] = mountBar(['a', 'b']);
    store.setDirty(a, true);
    vi.mocked(confirm).mockResolvedValue(false);
    focusTab('a');
    await tabFor('a').trigger('keydown', { key: 'Delete' });
    await flushPromises();
    expect(tabTitles()).toEqual(['a●', 'b']);
    expect(store.isDirty(a)).toBe(true);
    expect(document.activeElement).toBe(tabFor('a').element);
  });
});

describe('TabBar keyboard', () => {
  it('moves focus with the arrows and wraps around', async () => {
    mountBar(['a', 'b', 'c']);
    focusTab('a');
    await tabFor('a').trigger('keydown', { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabFor('c').element);
    await tabFor('c').trigger('keydown', { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabFor('a').element);
  });

  it('jumps to the first and last tab with Home and End', async () => {
    mountBar(['a', 'b', 'c']);
    focusTab('b');
    await tabFor('b').trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(tabFor('c').element);
    await tabFor('c').trigger('keydown', { key: 'Home' });
    expect(document.activeElement).toBe(tabFor('a').element);
  });

  it('does not change the active tab when only moving focus', async () => {
    mountBar(['a', 'b']);
    await tabFor('b').trigger('keydown', { key: 'Home' });
    expect(store.activeTab?.path).toBe('b');
  });

  it('ignores unrelated keys without swallowing them', async () => {
    mountBar(['a']);
    const event = new KeyboardEvent('keydown', {
      key: 'x',
      bubbles: true,
      cancelable: true,
    });
    tabFor('a').element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('reorders with Ctrl+Shift+arrows and keeps focus on the moved tab', async () => {
    mountBar(['a', 'b', 'c']);
    focusTab('a');
    await tabFor('a').trigger('keydown', {
      key: 'ArrowRight',
      ctrlKey: true,
      shiftKey: true,
    });
    await flushPromises();
    expect(tabTitles()).toEqual(['b', 'a', 'c']);
    expect(document.activeElement).toBe(tabFor('a').element);
  });

  it('does not wrap when reordering past the edges', async () => {
    mountBar(['a', 'b']);
    await tabFor('a').trigger('keydown', {
      key: 'ArrowLeft',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(tabTitles()).toEqual(['a', 'b']);
  });
});

describe('TabBar context menu', () => {
  it('opens at the pointer on right click with the four actions', async () => {
    mountBar(['a', 'b']);
    await tabFor('a').trigger('contextmenu', { clientX: 12, clientY: 34 });
    const menu = wrapper.get('[role="menu"]');
    expect(menu.attributes('style')).toContain('left: 12px');
    const labels = wrapper
      .findAll('[role="menuitem"]')
      .map((item) => item.find('span').text());
    expect(labels).toEqual([
      'Cerrar',
      'Cerrar otras',
      'Cerrar a la derecha',
      'Duplicar',
    ]);
  });

  it('opens from the keyboard with the context menu key and Shift+F10', async () => {
    mountBar(['a']);
    await tabFor('a').trigger('keydown', { key: 'ContextMenu' });
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
    wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('close');
    await flushPromises();
    await tabFor('a').trigger('keydown', { key: 'F10', shiftKey: true });
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
  });

  it('disables actions that cannot apply', async () => {
    mountBar(['a']);
    await tabFor('a').trigger('contextmenu');
    const disabled = wrapper
      .findAll('[role="menuitem"][aria-disabled="true"]')
      .map((item) => item.find('span').text());
    expect(disabled).toEqual(['Cerrar otras', 'Cerrar a la derecha']);
  });

  it('disables close-to-the-right on the last tab only', async () => {
    mountBar(['a', 'b']);
    await tabFor('a').trigger('contextmenu');
    expect(
      wrapper.findAll('[aria-disabled="true"]').map((item) => item.text()),
    ).toEqual([]);
    wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('close');
    await flushPromises();
    await tabFor('b').trigger('contextmenu');
    expect(wrapper.get('[aria-disabled="true"]').text()).toContain(
      'Cerrar a la derecha',
    );
  });

  it('disables duplicate at the tab limit', async () => {
    mountBar(['a']);
    vi.spyOn(store, 'canOpen', 'get').mockReturnValue(false);
    await tabFor('a').trigger('contextmenu');
    await flushPromises();
    const duplicate = wrapper
      .findAll('[role="menuitem"]')
      .find((item) => item.text().startsWith('Duplicar'))!;
    expect(duplicate.attributes('aria-disabled')).toBe('true');
  });

  it('duplicates from the menu and closes the menu', async () => {
    mountBar(['a', 'b']);
    await tabFor('a').trigger('contextmenu');
    const duplicate = wrapper
      .findAll('[role="menuitem"]')
      .find((item) => item.text().startsWith('Duplicar'))!;
    await duplicate.trigger('click');
    await flushPromises();
    expect(tabTitles()).toEqual(['a', 'a', 'b']);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('closes from the menu and moves the focus to the new active tab', async () => {
    mountBar(['a', 'b']);
    await tabFor('b').trigger('contextmenu');
    await flushPromises();
    const close = wrapper
      .findAll('[role="menuitem"]')
      .find((item) => item.text().startsWith('Cerrar'))!;
    await close.trigger('click');
    await flushPromises();
    expect(tabTitles()).toEqual(['a']);
    expect(document.activeElement).toBe(tabFor('a').element);
  });

  it('closes the other tabs from the menu', async () => {
    mountBar(['a', 'b', 'c']);
    await tabFor('b').trigger('contextmenu');
    const others = wrapper
      .findAll('[role="menuitem"]')
      .find((item) => item.text().startsWith('Cerrar otras'))!;
    await others.trigger('click');
    await flushPromises();
    expect(tabTitles()).toEqual(['b']);
  });

  it('closes the tabs to the right from the menu', async () => {
    mountBar(['a', 'b', 'c']);
    await tabFor('a').trigger('contextmenu');
    const right = wrapper
      .findAll('[role="menuitem"]')
      .find((item) => item.text().startsWith('Cerrar a la derecha'))!;
    await right.trigger('click');
    await flushPromises();
    expect(tabTitles()).toEqual(['a']);
  });

  it('returns focus to the tab when the menu closes with Escape', async () => {
    mountBar(['a', 'b']);
    await tabFor('a').trigger('contextmenu');
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(tabFor('a').element);
  });

  it('does not steal focus when the menu is dismissed by clicking elsewhere', async () => {
    mountBar(['a']);
    const outside = document.createElement('button');
    document.body.append(outside);
    await tabFor('a').trigger('contextmenu');
    outside.focus();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe('TabBar pointer reordering', () => {
  it('moves a tab to where it is dropped with the real pointer sequence', async () => {
    mountBar(['a', 'b', 'c']);
    layOutTabs();
    const release = await dragTab('a', 50, 260);
    await release();
    expect(tabTitles()).toEqual(['b', 'c', 'a']);
  });

  it('shows the dragged tab and the drop marker while dragging', async () => {
    mountBar(['a', 'b', 'c']);
    layOutTabs();
    await dragTab('a', 50, 260);
    const items = wrapper.findAll('.tab-bar__item');
    expect(items[0].classes()).toContain('tab-bar__item--dragging');
    expect(items[0].attributes('style')).toContain('translateX(210px)');
    expect(items[2].classes()).toContain('tab-bar__item--drop-after');
  });

  it('leaves the order alone when the pointer is released where it started', async () => {
    mountBar(['a', 'b', 'c']);
    layOutTabs();
    const release = await dragTab('b', 150, 152);
    await release();
    expect(tabTitles()).toEqual(['a', 'b', 'c']);
  });

  it('does not start a drag from the close button', async () => {
    mountBar(['a', 'b']);
    layOutTabs();
    const close = wrapper.findAll('.tab-bar__close')[0].element;
    close.dispatchEvent(pointer('pointerdown', 50));
    close.dispatchEvent(pointer('pointermove', 250));
    await flushPromises();
    expect(wrapper.find('.tab-bar__item--dragging').exists()).toBe(false);
  });

  it('cancels the drag when the pointer is cancelled', async () => {
    mountBar(['a', 'b', 'c']);
    layOutTabs();
    await dragTab('a', 50, 260);
    tabFor('a').element.dispatchEvent(pointer('pointercancel', 260));
    await flushPromises();
    expect(wrapper.find('.tab-bar__item--dragging').exists()).toBe(false);
    expect(tabTitles()).toEqual(['a', 'b', 'c']);
  });

  it('keeps a plain click from reordering', async () => {
    mountBar(['a', 'b']);
    layOutTabs();
    tabFor('a').element.dispatchEvent(pointer('pointerdown', 50));
    tabFor('a').element.dispatchEvent(pointer('pointerup', 50));
    await tabFor('a').trigger('click');
    expect(tabTitles()).toEqual(['a', 'b']);
    expect(store.activeTab?.path).toBe('a');
  });
});

describe('TabBar notice', () => {
  it('announces the notice and lets the user dismiss it', async () => {
    mountBar(['a']);
    store.notice = 'Se omitió 1 pestaña';
    await flushPromises();
    const status = wrapper.get('[role="status"]');
    expect(status.text()).toContain('Se omitió 1 pestaña');
    await status.get('button').trigger('click');
    expect(status.text()).toBe('');
  });
});

describe('TabBar inside the shell', () => {
  it('still renders when localStorage throws on read and write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    setActivePinia(createPinia());
    useTabsStore().open('a');
    const shell = mount(AppShell, {
      slots: { tabs: TabBar },
      attachTo: document.body,
    });
    expect(shell.find('.shell__tabs [role="tablist"]').exists()).toBe(true);
    shell.unmount();
    mountBar([]);
  });
});
