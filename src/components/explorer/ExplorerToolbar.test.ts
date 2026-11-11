import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { FolderView } from '../../services/filesApi';
import ExplorerToolbar from './ExplorerToolbar.vue';

const VIEW: FolderView = {
  mode: 'grid',
  columns: ['type', 'size', 'modified'],
  sort: 'name',
  sort_direction: 'asc',
  updated_ms: 0,
};

type Props = InstanceType<typeof ExplorerToolbar>['$props'];

function mountToolbar(props: Partial<Props> = {}) {
  return mount(ExplorerToolbar, {
    props: {
      view: VIEW,
      filter: '',
      showHidden: false,
      canGoBack: true,
      canGoForward: true,
      canGoUp: true,
      isLoading: false,
      isFavorite: false,
      canCheckServer: true,
      isCheckingServer: false,
      ...props,
    } as Props,
  });
}

const button = (wrapper: ReturnType<typeof mountToolbar>, label: string) =>
  wrapper
    .findAll('button')
    .find(
      (item) =>
        item.attributes('aria-label') === label || item.text().trim() === label,
    );

describe('ExplorerToolbar navigation', () => {
  it('disables back, forward and up when there is nowhere to go', () => {
    const wrapper = mountToolbar({
      canGoBack: false,
      canGoForward: false,
      canGoUp: false,
    });
    for (const label of ['Atrás', 'Adelante', 'Subir un nivel']) {
      expect(button(wrapper, label)?.attributes('disabled')).toBeDefined();
    }
    expect(
      button(wrapper, 'Actualizar')?.attributes('disabled'),
    ).toBeUndefined();
  });

  it('disables refresh while a load is in flight', () => {
    const wrapper = mountToolbar({ isLoading: true });
    expect(button(wrapper, 'Actualizar')?.attributes('disabled')).toBeDefined();
  });

  it('emits each navigation action', async () => {
    const wrapper = mountToolbar();
    for (const label of ['Atrás', 'Adelante', 'Subir un nivel', 'Actualizar']) {
      await button(wrapper, label)?.trigger('click');
    }
    expect(Object.keys(wrapper.emitted())).toEqual(
      expect.arrayContaining(['back', 'forward', 'up', 'refresh']),
    );
  });
});

describe('ExplorerToolbar view controls', () => {
  it('marks the current view mode as pressed and no other', () => {
    const wrapper = mountToolbar({ view: { ...VIEW, mode: 'list' } });
    const pressed = wrapper
      .get('[aria-label="Vista"]')
      .findAll('button')
      .filter((item) => item.attributes('aria-pressed') === 'true');
    expect(pressed.map((item) => item.text())).toEqual(['Lista']);
  });

  it('offers the column toggles only in the details view', () => {
    expect(mountToolbar().find('[aria-label="Columnas"]').exists()).toBe(false);
    const details = mountToolbar({ view: { ...VIEW, mode: 'details' } });
    expect(details.find('[aria-label="Columnas"]').exists()).toBe(true);
  });

  it('reflects which columns are active and toggles one', async () => {
    const wrapper = mountToolbar({
      view: { ...VIEW, mode: 'details', columns: ['size'] },
    });
    const group = wrapper.get('[aria-label="Columnas"]');
    const state = group
      .findAll('button')
      .map((item) => [item.text(), item.attributes('aria-pressed')]);
    expect(state).toEqual([
      ['Tipo', 'false'],
      ['Tamaño', 'true'],
      ['Modificado', 'false'],
      ['SVN', 'false'],
    ]);
    await group.findAll('button')[2].trigger('click');
    await group.findAll('button')[3].trigger('click');
    expect(wrapper.emitted('toggleColumn')).toEqual([['modified'], ['svn']]);
  });

  it('emits the chosen view mode', async () => {
    const wrapper = mountToolbar();
    await button(wrapper, 'Detalles')?.trigger('click');
    expect(wrapper.emitted('changeView')).toEqual([[{ mode: 'details' }]]);
  });

  it('emits the sort key and flips the direction', async () => {
    const wrapper = mountToolbar();
    await wrapper.get('select').setValue('size');
    await button(wrapper, 'Orden ascendente')?.trigger('click');
    expect(wrapper.emitted('changeView')).toEqual([
      [{ sort: 'size' }],
      [{ sort_direction: 'desc' }],
    ]);
    const desc = mountToolbar({ view: { ...VIEW, sort_direction: 'desc' } });
    await button(desc, 'Orden descendente')?.trigger('click');
    expect(desc.emitted('changeView')).toEqual([[{ sort_direction: 'asc' }]]);
  });
});

describe('ExplorerToolbar hidden entries and filter', () => {
  it('reflects the hidden toggle in aria-pressed and emits it', async () => {
    const wrapper = mountToolbar({ showHidden: true });
    const toggle = button(wrapper, 'Ocultos')!;
    expect(toggle.attributes('aria-pressed')).toBe('true');
    await toggle.trigger('click');
    expect(wrapper.emitted('toggleHidden')).toHaveLength(1);
  });

  it('keeps the typed filter and emits every change', async () => {
    const wrapper = mountToolbar({ filter: 'inf' });
    const input = wrapper.get('input[type="search"]');
    expect((input.element as HTMLInputElement).value).toBe('inf');
    expect(input.attributes('aria-label')).toBe('Filtrar por nombre');
    await input.setValue('informe');
    expect(wrapper.emitted('update:filter')).toEqual([['informe']]);
  });

  it('exposes the controls as a labelled toolbar', () => {
    const wrapper = mountToolbar();
    expect(wrapper.get('[role="toolbar"]').attributes('aria-label')).toBe(
      'Herramientas de la carpeta',
    );
  });
});

describe('ExplorerToolbar favorite star', () => {
  const star = (wrapper: ReturnType<typeof mountToolbar>) =>
    button(wrapper, 'Marcar como favorita')!;

  it('is a toggle that reflects whether the folder is a favorite', () => {
    expect(star(mountToolbar()).attributes('aria-pressed')).toBe('false');
    const marked = mountToolbar({ isFavorite: true });
    expect(star(marked).attributes('aria-pressed')).toBe('true');
  });

  it('keeps one accessible name in both states', () => {
    const marked = mountToolbar({ isFavorite: true });
    expect(star(marked).attributes('aria-label')).toBe('Marcar como favorita');
  });

  it('asks to toggle the favorite', async () => {
    const wrapper = mountToolbar();
    await star(wrapper).trigger('click');
    expect(wrapper.emitted('toggleFavorite')).toHaveLength(1);
  });
});

describe('ExplorerToolbar server check', () => {
  const check = (wrapper: ReturnType<typeof mountToolbar>) =>
    button(wrapper, 'Comprobar servidor')!;

  it('is disabled with a reason outside a working copy and emits nothing', async () => {
    const wrapper = mountToolbar({ canCheckServer: false });
    expect(check(wrapper).attributes('disabled')).toBeDefined();
    expect(check(wrapper).attributes('title')).toContain('copia de trabajo');
    await check(wrapper).trigger('click');
    expect(wrapper.emitted('checkServer')).toBeUndefined();
  });

  it('is disabled and busy while a check is running', () => {
    const wrapper = mountToolbar({ isCheckingServer: true });
    expect(check(wrapper).attributes('disabled')).toBeDefined();
    expect(check(wrapper).attributes('aria-busy')).toBe('true');
  });

  it('asks to check the server', async () => {
    const wrapper = mountToolbar();
    await check(wrapper).trigger('click');
    expect(wrapper.emitted('checkServer')).toHaveLength(1);
  });
});
