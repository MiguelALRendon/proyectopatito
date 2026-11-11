import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../services/filesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/filesApi')>()),
  fsList: vi.fn(),
  wcStatusMap: vi.fn(),
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
}));
vi.mock('../../services/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/tauri')>()),
  wcInfo: vi.fn(),
}));
vi.mock('../../composables/useConfirm', () => ({ confirm: vi.fn() }));

import {
  fsList,
  uiStateGet,
  uiStateSet,
  type DirListing,
  type UiStateView,
} from '../../services/filesApi';
import { useExplorerStore } from '../../stores/explorer';
import { useTabsStore } from '../../stores/tabs';
import FavoritesSidebar from './FavoritesSidebar.vue';

type Stored = UiStateView['favorites'][number];

const ROW_HEIGHT = 40;
const stored = (path: string, exists = true): Stored => ({
  path,
  name: path.toUpperCase(),
  exists,
});

const listing = (path: string): DirListing => ({
  path,
  entries: [],
  truncated: false,
  wc: null,
});

let wrapper: VueWrapper;
let tabs: ReturnType<typeof useTabsStore>;
let explorer: ReturnType<typeof useExplorerStore>;

async function mountSidebar(favorites: Stored[]) {
  vi.mocked(uiStateGet).mockResolvedValue({
    version: 1,
    favorites,
    tabs: [],
    active_tab: null,
    views: {},
  });
  setActivePinia(createPinia());
  tabs = useTabsStore();
  explorer = useExplorerStore();
  await tabs.restore();
  vi.mocked(fsList).mockResolvedValue(listing(''));
  await explorer.attach(tabs.activeId as string, '');
  wrapper = mount(FavoritesSidebar, { attachTo: document.body });
  await flushPromises();
  await tabs.flush();
  vi.mocked(uiStateSet).mockClear();
  return wrapper;
}

const rows = () => wrapper.findAll('.favorites__item');
const names = () => wrapper.findAll('.favorites__name').map((n) => n.text());
const link = (name: string) =>
  wrapper
    .findAll('.favorites__link')
    .find((candidate) => candidate.find('.favorites__name').text() === name)!;
const focusedName = () =>
  document.activeElement?.querySelector('.favorites__name')?.textContent;
const savedFavorites = () => {
  const calls = vi.mocked(uiStateSet).mock.calls;
  return calls[calls.length - 1][0].favorites.map((item) => item.path);
};

function layOutRows() {
  rows().forEach((row, index) => {
    vi.spyOn(row.element, 'getBoundingClientRect').mockReturnValue({
      top: index * ROW_HEIGHT,
      bottom: (index + 1) * ROW_HEIGHT,
      left: 0,
      right: 100,
    } as DOMRect);
  });
}

function pointer(type: string, clientY: number, button = 0) {
  const event = new MouseEvent(type, { clientY, button, bubbles: true });
  return Object.assign(event, { pointerId: 1 });
}

async function dragLink(name: string, fromY: number, toY: number) {
  const element = link(name).element;
  element.dispatchEvent(pointer('pointerdown', fromY));
  element.dispatchEvent(pointer('pointermove', toY));
  await flushPromises();
  return async () => {
    element.dispatchEvent(pointer('pointerup', toY));
    await flushPromises();
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(uiStateSet).mockImplementation(async (request) => ({
    ...request,
    favorites: request.favorites.map((item) => ({
      ...item,
      exists: item.path !== 'muerta',
    })),
    tabs: [],
    views: {},
  }));
});

afterEach(() => {
  wrapper.unmount();
  vi.restoreAllMocks();
});

describe('FavoritesSidebar empty and unavailable', () => {
  it('explains how to add a favorite when there is none', async () => {
    await mountSidebar([]);
    expect(wrapper.text()).toContain('Marca una carpeta con la estrella');
    expect(wrapper.find('ul').exists()).toBe(false);
  });

  it('marks a favorite whose folder is gone with text, not only a color', async () => {
    await mountSidebar([stored('viva'), stored('muerta', false)]);
    const gone = link('MUERTA');
    expect(gone.text()).toContain('No disponible');
    expect(link('VIVA').text()).not.toContain('No disponible');
    expect(rows()[1].classes()).toContain('favorites__item--unavailable');
  });

  it('keeps the unavailable favorite in the list and lets it be renamed or removed', async () => {
    await mountSidebar([stored('muerta', false)]);
    expect(names()).toEqual(['MUERTA']);
    await wrapper
      .get('[aria-label="Quitar el favorito MUERTA"]')
      .trigger('click');
    expect(names()).toEqual([]);
  });

  it('marks a favorite that stops opening and does not leave the current folder', async () => {
    await mountSidebar([stored('x')]);
    vi.mocked(fsList).mockRejectedValueOnce({ kind: 'io', message: 'no' });
    await link('X').trigger('click');
    await flushPromises();
    expect(link('X').text()).toContain('No disponible');
    expect(explorer.activeState?.location).toBe('');
  });
});

describe('FavoritesSidebar inline rename', () => {
  const startRename = async (name: string) => {
    await link(name).trigger('keydown', { key: 'F2' });
    await flushPromises();
    return wrapper.get<HTMLInputElement>('.favorites__rename');
  };

  it('starts with F2 on the current name, selected and focused', async () => {
    await mountSidebar([stored('a')]);
    const input = await startRename('A');
    expect(input.element.value).toBe('A');
    expect(document.activeElement).toBe(input.element);
  });

  it('confirms with Enter, trimming the name, and returns the focus to the link', async () => {
    await mountSidebar([stored('a')]);
    const input = await startRename('A');
    await input.setValue('  Nuevo nombre  ');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(names()).toEqual(['Nuevo nombre']);
    expect(wrapper.find('.favorites__rename').exists()).toBe(false);
    expect(focusedName()).toBe('Nuevo nombre');
    await tabs.flush();
    expect(vi.mocked(uiStateSet).mock.calls[0][0].favorites).toEqual([
      { path: 'a', name: 'Nuevo nombre' },
    ]);
  });

  it('cancels with Escape and writes nothing', async () => {
    await mountSidebar([stored('a')]);
    const input = await startRename('A');
    await input.setValue('Otro');
    await input.trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(names()).toEqual(['A']);
    await tabs.flush();
    expect(uiStateSet).not.toHaveBeenCalled();
  });

  it('keeps the old name when the new one is blank', async () => {
    await mountSidebar([stored('a')]);
    const input = await startRename('A');
    await input.setValue('    ');
    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(names()).toEqual(['A']);
  });

  it('limits the name length in the field', async () => {
    await mountSidebar([stored('a')]);
    const input = await startRename('A');
    expect(input.attributes('maxlength')).toBe('256');
  });

  it('confirms once when leaving the field, even if Enter was pressed first', async () => {
    await mountSidebar([stored('a')]);
    const input = await startRename('A');
    await input.setValue('B');
    await input.trigger('keydown', { key: 'Enter' });
    await input.trigger('blur');
    await flushPromises();
    await tabs.flush();
    expect(vi.mocked(uiStateSet)).toHaveBeenCalledTimes(1);
  });

  it('starts from the pencil button too', async () => {
    await mountSidebar([stored('a')]);
    await wrapper
      .get('[aria-label="Renombrar el favorito A"]')
      .trigger('click');
    expect(wrapper.find('.favorites__rename').exists()).toBe(true);
  });
});

describe('FavoritesSidebar removal', () => {
  it('removes with Delete and moves the focus to the next favorite', async () => {
    await mountSidebar([stored('a'), stored('b'), stored('c')]);
    await link('B').trigger('keydown', { key: 'Delete' });
    await flushPromises();
    expect(names()).toEqual(['A', 'C']);
    expect(focusedName()).toBe('C');
    await tabs.flush();
    expect(savedFavorites()).toEqual(['a', 'c']);
  });

  it('moves the focus to the previous favorite when the last one is removed', async () => {
    await mountSidebar([stored('a'), stored('b')]);
    await link('B').trigger('keydown', { key: 'Delete' });
    await flushPromises();
    expect(focusedName()).toBe('A');
  });

  it('removes from the button without opening the folder', async () => {
    await mountSidebar([stored('a')]);
    await wrapper.get('[aria-label="Quitar el favorito A"]').trigger('click');
    expect(names()).toEqual([]);
    expect(fsList).toHaveBeenCalledTimes(1);
  });
});

describe('FavoritesSidebar pointer reordering', () => {
  it('moves a favorite to where it is dropped, with the real pointer sequence', async () => {
    await mountSidebar([stored('a'), stored('b'), stored('c')]);
    layOutRows();
    const release = await dragLink('A', 20, 110);
    await release();
    expect(names()).toEqual(['B', 'C', 'A']);
    await tabs.flush();
    expect(savedFavorites()).toEqual(['b', 'c', 'a']);
  });

  it('does not navigate when the drag ends over the same button', async () => {
    await mountSidebar([stored('a'), stored('b')]);
    layOutRows();
    const release = await dragLink('A', 20, 70);
    await release();
    link('A').element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(fsList).toHaveBeenCalledTimes(1);
  });

  it('shows the dragged favorite and the drop marker while dragging', async () => {
    await mountSidebar([stored('a'), stored('b'), stored('c')]);
    layOutRows();
    await dragLink('A', 20, 110);
    expect(rows()[0].classes()).toContain('favorites__item--dragging');
    expect(rows()[2].classes()).toContain('favorites__item--drop-after');
  });

  it('leaves the order alone for a tiny movement and still navigates on click', async () => {
    await mountSidebar([stored('a'), stored('b')]);
    layOutRows();
    const release = await dragLink('B', 60, 62);
    await release();
    expect(names()).toEqual(['A', 'B']);
    vi.mocked(fsList).mockResolvedValueOnce(listing('b'));
    await link('B').trigger('click');
    await flushPromises();
    expect(explorer.activeState?.location).toBe('b');
  });

  it('cancels the drag when the pointer is cancelled', async () => {
    await mountSidebar([stored('a'), stored('b')]);
    layOutRows();
    await dragLink('A', 20, 110);
    link('A').element.dispatchEvent(pointer('pointercancel', 110));
    await flushPromises();
    expect(names()).toEqual(['A', 'B']);
    expect(wrapper.find('.favorites__item--dragging').exists()).toBe(false);
  });

  it('ignores a drag started with a secondary button', async () => {
    await mountSidebar([stored('a'), stored('b')]);
    layOutRows();
    const element = link('A').element;
    element.dispatchEvent(pointer('pointerdown', 20, 2));
    element.dispatchEvent(pointer('pointermove', 100, 2));
    await flushPromises();
    expect(wrapper.find('.favorites__item--dragging').exists()).toBe(false);
  });
});

describe('FavoritesSidebar keyboard', () => {
  it('moves the focus with the arrows and stops at the edges', async () => {
    await mountSidebar([stored('a'), stored('b')]);
    await link('A').trigger('keydown', { key: 'ArrowDown' });
    expect(focusedName()).toBe('B');
    await link('B').trigger('keydown', { key: 'ArrowDown' });
    expect(focusedName()).toBe('B');
    await link('B').trigger('keydown', { key: 'Home' });
    expect(focusedName()).toBe('A');
    await link('A').trigger('keydown', { key: 'End' });
    expect(focusedName()).toBe('B');
  });

  it('reorders with Ctrl+Shift and the arrows and keeps the focus on the moved one', async () => {
    await mountSidebar([stored('a'), stored('b'), stored('c')]);
    await link('A').trigger('keydown', {
      key: 'ArrowDown',
      ctrlKey: true,
      shiftKey: true,
    });
    await flushPromises();
    expect(names()).toEqual(['B', 'A', 'C']);
    expect(focusedName()).toBe('A');
  });

  it('does not reorder past the edges', async () => {
    await mountSidebar([stored('a'), stored('b')]);
    await link('A').trigger('keydown', {
      key: 'ArrowUp',
      ctrlKey: true,
      shiftKey: true,
    });
    await flushPromises();
    expect(names()).toEqual(['A', 'B']);
  });

  it('keeps the action buttons out of the tab order', async () => {
    await mountSidebar([stored('a')]);
    const actions = wrapper.findAll('.favorites__action');
    expect(actions).toHaveLength(2);
    actions.forEach((action) =>
      expect(action.attributes('tabindex')).toBe('-1'),
    );
  });
});

describe('FavoritesSidebar semantics', () => {
  it('is a labelled region with a labelled list of favorites', async () => {
    await mountSidebar([stored('a')]);
    expect(wrapper.get('section').attributes('aria-labelledby')).toBe(
      'favorites-title',
    );
    expect(wrapper.get('ul').attributes('aria-label')).toBe(
      'Carpetas favoritas',
    );
  });

  it('names each action with the favorite it acts on', async () => {
    await mountSidebar([stored('a'), stored('b')]);
    const labels = wrapper
      .findAll('.favorites__action')
      .map((action) => action.attributes('aria-label'));
    expect(labels).toEqual([
      'Renombrar el favorito A',
      'Quitar el favorito A',
      'Renombrar el favorito B',
      'Quitar el favorito B',
    ]);
  });
});

describe('FavoritesSidebar happy path', () => {
  it('lists the favorites in order and navigates the active tab on click', async () => {
    await mountSidebar([stored('docs'), stored('src')]);
    expect(names()).toEqual(['DOCS', 'SRC']);
    vi.mocked(fsList).mockResolvedValueOnce(listing('src'));
    await link('SRC').trigger('click');
    await flushPromises();
    expect(explorer.activeState?.location).toBe('src');
    expect(tabs.tabs).toHaveLength(1);
  });
});
