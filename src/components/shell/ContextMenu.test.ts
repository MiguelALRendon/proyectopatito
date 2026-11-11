import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ContextMenu, { type ContextMenuItem } from './ContextMenu.vue';

let wrapper: VueWrapper;

function items(overrides: Partial<ContextMenuItem>[] = []): ContextMenuItem[] {
  const base: ContextMenuItem[] = [
    { label: 'Cerrar', shortcut: 'Supr', action: vi.fn() },
    { label: 'Cerrar otras', disabled: true, action: vi.fn() },
    { label: 'Duplicar', separatorBefore: true, action: vi.fn() },
  ];
  return base.map((item, index) => ({ ...item, ...overrides[index] }));
}

function mountMenu(list = items(), position = { x: 10, y: 20 }) {
  wrapper = mount(ContextMenu, {
    props: { ...position, label: 'Acciones', items: list },
    attachTo: document.body,
  });
  return wrapper;
}

function menuItem(label: string) {
  const entries = wrapper.findAll('[role="menuitem"]');
  return entries.find((entry) => entry.text().startsWith(label))!;
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

afterEach(() => {
  wrapper.unmount();
  vi.restoreAllMocks();
});

describe('ContextMenu semantics', () => {
  it('exposes a labelled menu with menuitems and a separator', () => {
    mountMenu();
    const menu = wrapper.get('[role="menu"]');
    expect(menu.attributes('aria-label')).toBe('Acciones');
    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(3);
    expect(wrapper.findAll('[role="separator"]')).toHaveLength(1);
  });

  it('shows the shortcut next to its label', () => {
    mountMenu();
    expect(wrapper.get('kbd').text()).toBe('Supr');
  });

  it('marks disabled entries with aria-disabled', () => {
    mountMenu();
    expect(menuItem('Cerrar otras').attributes('aria-disabled')).toBe('true');
    expect(menuItem('Duplicar').attributes('aria-disabled')).toBeUndefined();
  });
});

describe('ContextMenu positioning', () => {
  it('keeps the menu inside the window', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
    const far = { x: window.innerWidth + 500, y: window.innerHeight + 500 };
    mountMenu(items(), far);
    await flushPromises();
    const style = wrapper.get('[role="menu"]').attributes('style');
    expect(style).toContain(`left: ${window.innerWidth - 200}px`);
    expect(style).toContain(`top: ${window.innerHeight - 100}px`);
  });

  it('places it at the pointer when it fits', () => {
    mountMenu(items(), { x: 33, y: 44 });
    const style = wrapper.get('[role="menu"]').attributes('style');
    expect(style).toContain('left: 33px');
    expect(style).toContain('top: 44px');
  });
});

describe('ContextMenu closing', () => {
  it('closes with Escape', () => {
    mountMenu();
    press('Escape');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('closes with Tab so focus can leave the menu', () => {
    mountMenu();
    press('Tab');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('closes on a pointer down outside the menu', () => {
    mountMenu();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('stays open on a pointer down inside the menu', () => {
    mountMenu();
    const menu = wrapper.get('[role="menu"]').element;
    menu.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('closes when the window loses focus', () => {
    mountMenu();
    window.dispatchEvent(new Event('blur'));
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('stops listening once unmounted', () => {
    mountMenu();
    const previous = wrapper;
    previous.unmount();
    press('Escape');
    expect(previous.emitted('close')).toBeUndefined();
    mountMenu();
  });
});

describe('ContextMenu keyboard', () => {
  it('focuses the first enabled entry on open', () => {
    mountMenu(items([{ disabled: true }, { disabled: false }]));
    expect(document.activeElement).toBe(menuItem('Cerrar otras').element);
  });

  it('moves with arrows, skips disabled entries and wraps around', () => {
    mountMenu();
    expect(document.activeElement).toBe(menuItem('Cerrar').element);
    press('ArrowDown');
    expect(document.activeElement).toBe(menuItem('Duplicar').element);
    press('ArrowDown');
    expect(document.activeElement).toBe(menuItem('Cerrar').element);
    press('ArrowUp');
    expect(document.activeElement).toBe(menuItem('Duplicar').element);
  });

  it('jumps to the first and last enabled entries with Home and End', () => {
    mountMenu();
    press('End');
    expect(document.activeElement).toBe(menuItem('Duplicar').element);
    press('Home');
    expect(document.activeElement).toBe(menuItem('Cerrar').element);
  });

  it('survives a menu whose entries are all disabled', () => {
    mountMenu(items().map((item) => ({ ...item, disabled: true })));
    expect(() => {
      press('ArrowDown');
      press('ArrowUp');
      press('Home');
      press('End');
    }).not.toThrow();
  });

  it('runs the action on Enter and on Space, then closes', async () => {
    const list = items();
    mountMenu(list);
    await menuItem('Cerrar').trigger('keydown', { key: 'Enter' });
    await menuItem('Duplicar').trigger('keydown', { key: ' ' });
    expect(list[0].action).toHaveBeenCalledTimes(1);
    expect(list[2].action).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('close')).toHaveLength(2);
  });
});

describe('ContextMenu selection', () => {
  it('ignores clicks on disabled entries', async () => {
    const list = items();
    mountMenu(list);
    await menuItem('Cerrar otras').trigger('click');
    expect(list[1].action).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('closes before running the action so a confirmation is not fought over', async () => {
    const closedWhenRun: number[] = [];
    const action = () =>
      closedWhenRun.push(wrapper.emitted('close')?.length ?? 0);
    mountMenu(items([{ action }]));
    await menuItem('Cerrar').trigger('click');
    expect(closedWhenRun).toEqual([1]);
  });

  it('runs the action on click and closes', async () => {
    const list = items();
    mountMenu(list);
    await menuItem('Duplicar').trigger('click');
    expect(list[2].action).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
