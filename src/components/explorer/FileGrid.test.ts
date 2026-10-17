import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { FileEntry } from '../../services/filesApi';
import { localBadge, NORMAL_BADGE } from '../../utils/svnBadges';
import FileGrid from './FileGrid.vue';

function entry(name: string, extra: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    kind: 'file',
    size: 0,
    modified_ms: null,
    hidden: false,
    read_only: false,
    is_link: false,
    escapes_workspace: false,
    cloud_only: false,
    ...extra,
  };
}

const ENTRIES = [
  entry('carpeta', { kind: 'dir' }),
  entry('a.txt'),
  entry('b.txt'),
  entry('c.txt'),
];

let wrapper: VueWrapper;

function mountGrid(entries: FileEntry[] = ENTRIES) {
  wrapper = mount(FileGrid, {
    props: {
      entries,
      selected: [],
      'onUpdate:selected': (names: string[]) =>
        wrapper.setProps({ selected: names }),
    },
    attachTo: document.body,
  });
  return wrapper;
}

const rows = () => wrapper.findAll('[role="row"]');
const row = (name: string) =>
  rows().find((item) => item.text().includes(name))!;
const selectedNames = () =>
  rows()
    .filter((item) => item.attributes('aria-selected') === 'true')
    .map((item) => item.text());

afterEach(() => wrapper.unmount());

describe('FileGrid semantics', () => {
  it('is a multiselectable grid with a row and a cell per entry', () => {
    mountGrid();
    const grid = wrapper.get('[role="grid"]');
    expect(grid.attributes('aria-multiselectable')).toBe('true');
    expect(grid.attributes('aria-label')).toBe('Contenido de la carpeta');
    expect(rows()).toHaveLength(4);
    expect(wrapper.findAll('[role="gridcell"]')).toHaveLength(4);
  });

  it('names every row with its kind, so folders and files are told apart', () => {
    mountGrid();
    expect(rows().map((item) => item.attributes('aria-label'))).toEqual([
      'Carpeta: carpeta',
      'Archivo: a.txt',
      'Archivo: b.txt',
      'Archivo: c.txt',
    ]);
  });

  it('keeps exactly one row in the tab order and moves it with the focus', async () => {
    mountGrid();
    const tabbable = () =>
      rows().filter((item) => item.attributes('tabindex') === '0');
    expect(tabbable()).toHaveLength(1);
    expect(tabbable()[0].text()).toContain('carpeta');
    await row('b.txt').trigger('click');
    expect(tabbable().map((item) => item.text())).toEqual(['b.txt']);
  });

  it('shows the cloud indicator of a file that is only in the cloud', () => {
    mountGrid([entry('nube.bin', { cloud_only: true }), entry('local.bin')]);
    const flagged = rows()[0].find('[title="Solo en la nube"]');
    expect(flagged.exists()).toBe(true);
    expect(rows()[1].find('[title="Solo en la nube"]').exists()).toBe(false);
    expect(rows()[0].attributes('aria-label')).toContain('solo en la nube');
  });

  it('renders an empty grid without rows', () => {
    mountGrid([]);
    expect(rows()).toHaveLength(0);
  });
});

describe('FileGrid keyboard', () => {
  it('Delete does nothing at all', async () => {
    mountGrid();
    await row('a.txt').trigger('click');
    const before = selectedNames();
    await row('a.txt').trigger('keydown', { key: 'Delete' });
    expect(selectedNames()).toEqual(before);
    expect(wrapper.emitted('open')).toBeUndefined();
    expect(rows()).toHaveLength(4);
  });

  it('arrow keys move the selection and the real focus', async () => {
    mountGrid();
    await row('carpeta').trigger('click');
    await row('carpeta').trigger('keydown', { key: 'ArrowDown' });
    expect(selectedNames()).toEqual(['a.txt']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Archivo: a.txt',
    );
  });

  it('shift+arrow selects a range and ctrl+A selects everything', async () => {
    mountGrid();
    await row('a.txt').trigger('click');
    await row('a.txt').trigger('keydown', { key: 'ArrowDown', shiftKey: true });
    expect(selectedNames()).toEqual(['a.txt', 'b.txt']);
    await row('b.txt').trigger('keydown', { key: 'a', ctrlKey: true });
    expect(selectedNames()).toHaveLength(4);
  });

  it('Enter opens the focused entry and ctrl+Enter asks for a new tab', async () => {
    mountGrid();
    await row('carpeta').trigger('keydown', { key: 'Enter' });
    await row('a.txt').trigger('keydown', { key: 'Enter', ctrlKey: true });
    expect(wrapper.emitted('open')).toEqual([
      ['carpeta', false],
      ['a.txt', true],
    ]);
  });
});

describe('FileGrid mouse', () => {
  it('opens on double click and on middle click, never on a single click', async () => {
    mountGrid();
    await row('a.txt').trigger('click');
    expect(wrapper.emitted('open')).toBeUndefined();
    await row('a.txt').trigger('dblclick');
    await row('b.txt').trigger('auxclick', { button: 1 });
    expect(wrapper.emitted('open')).toEqual([
      ['a.txt', false],
      ['b.txt', true],
    ]);
  });

  it('selects several entries with ctrl+click and a range with shift+click', async () => {
    mountGrid();
    await row('a.txt').trigger('click');
    await row('c.txt').trigger('click', { ctrlKey: true });
    expect(selectedNames()).toEqual(['a.txt', 'c.txt']);
    await row('carpeta').trigger('click', { shiftKey: true });
    expect(selectedNames()).toEqual(['carpeta', 'a.txt', 'b.txt', 'c.txt']);
  });

  it('a plain click on one entry replaces the whole selection', async () => {
    mountGrid();
    await row('a.txt').trigger('click');
    await row('b.txt').trigger('click', { ctrlKey: true });
    await row('c.txt').trigger('click');
    expect(selectedNames()).toEqual(['c.txt']);
  });
});

describe('FileGrid states', () => {
  it('shows the state of a changed entry with text and names it in the row', () => {
    wrapper = mount(FileGrid, {
      props: {
        entries: ENTRIES,
        selected: [],
        badges: new Map([
          ['a.txt', [localBadge('conflicted')]],
          ['b.txt', [NORMAL_BADGE]],
        ]),
      },
    });
    expect(row('a.txt').find('.svn-badge').text()).toBe('En conflicto');
    expect(row('a.txt').attributes('aria-label')).toBe(
      'Archivo: a.txt, En conflicto',
    );
    expect(row('b.txt').find('.svn-badge').exists()).toBe(false);
    expect(row('c.txt').find('.svn-badge').exists()).toBe(false);
  });
});
