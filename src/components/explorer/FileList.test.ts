import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { FileEntry } from '../../services/filesApi';
import {
  CHANGES_BELOW_BADGE,
  NORMAL_BADGE,
  localBadge,
  type StateBadge,
} from '../../utils/svnBadges';
import FileList from './FileList.vue';

function entry(name: string, extra: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    kind: 'file',
    size: 2048,
    modified_ms: Date.UTC(2026, 0, 15, 12, 0),
    hidden: false,
    read_only: false,
    is_link: false,
    escapes_workspace: false,
    cloud_only: false,
    ...extra,
  };
}

const ENTRIES = [
  entry('carpeta', { kind: 'dir', size: 0 }),
  entry('notas.md'),
  entry('nube.bin', { cloud_only: true }),
];

type Props = InstanceType<typeof FileList>['$props'];

let wrapper: VueWrapper;

function mountList(props: Partial<Props> = {}) {
  wrapper = mount(FileList, {
    props: {
      entries: ENTRIES,
      columns: ['type', 'size', 'modified'],
      mode: 'details',
      sort: 'name',
      direction: 'asc',
      selected: [],
      'onUpdate:selected': (names: string[]) =>
        wrapper.setProps({ selected: names }),
      ...props,
    } as Props,
    attachTo: document.body,
  });
  return wrapper;
}

const dataRows = () => wrapper.findAll('[role="row"][aria-label]');
const headers = () =>
  wrapper.findAll('[role="columnheader"]').map((item) => item.text());

afterEach(() => wrapper.unmount());

describe('FileList details', () => {
  it('shows a sortable header with only the active columns', () => {
    mountList({ columns: ['size'] });
    expect(headers()).toEqual(['Nombre', 'Tamaño']);
    expect(dataRows()[1].findAll('[role="gridcell"]')).toHaveLength(2);
  });

  it('shows no column but the name when every column is off', () => {
    mountList({ columns: [] });
    expect(headers()).toEqual(['Nombre']);
    expect(dataRows()[0].findAll('[role="gridcell"]')).toHaveLength(1);
  });

  it('shows the svn column in the order of the toolbar, whatever the stored order', () => {
    mountList({ columns: ['svn', 'type'] });
    expect(headers()).toEqual(['Nombre', 'Tipo', 'SVN']);
  });

  it('shows type, size and modified date of each entry', () => {
    mountList();
    const cells = dataRows()[1]
      .findAll('[role="gridcell"]')
      .map((cell) => cell.text());
    expect(cells[1]).toBe('Archivo MD');
    expect(cells[2]).toBe('2 KB');
    expect(cells[3]).toMatch(/2026/);
    const folderCells = dataRows()[0]
      .findAll('[role="gridcell"]')
      .map((cell) => cell.text());
    expect(folderCells.slice(1, 3)).toEqual(['Carpeta', '-']);
  });

  it('exposes the sort state of the active column only', () => {
    mountList({ sort: 'size', direction: 'desc' });
    const state = wrapper
      .findAll('[role="columnheader"]')
      .map((item) => item.attributes('aria-sort'));
    expect(state).toEqual(['none', 'none', 'descending', 'none']);
    expect(wrapper.setProps({ sort: 'name', direction: 'asc' })).toBeDefined();
  });

  it('asks to sort by the clicked column', async () => {
    mountList();
    const buttons = wrapper.findAll('[role="columnheader"] button');
    await buttons[0].trigger('click');
    await buttons[3].trigger('click');
    expect(wrapper.emitted('sort')).toEqual([['name'], ['modified']]);
  });
});

describe('FileList list mode', () => {
  it('shows no header and no data columns', () => {
    mountList({ mode: 'list' });
    expect(wrapper.find('[role="columnheader"]').exists()).toBe(false);
    expect(dataRows()[1].findAll('[role="gridcell"]')).toHaveLength(1);
  });

  it('keeps a multiselectable grid with named rows', () => {
    mountList({ mode: 'list' });
    expect(
      wrapper.get('[role="grid"]').attributes('aria-multiselectable'),
    ).toBe('true');
    expect(dataRows().map((item) => item.attributes('aria-label'))).toEqual([
      'Carpeta: carpeta',
      'Archivo: notas.md',
      'Archivo: nube.bin, solo en la nube',
    ]);
  });
});

describe('FileList cloud and selection', () => {
  it('shows the cloud indicator of a cloud-only file in the listing', () => {
    mountList({ mode: 'list' });
    expect(dataRows()[2].find('[title="Solo en la nube"]').exists()).toBe(true);
    expect(dataRows()[1].find('[title="Solo en la nube"]').exists()).toBe(
      false,
    );
  });

  it('uses single-column keyboard movement and ignores Delete', async () => {
    mountList();
    await dataRows()[0].trigger('click');
    await dataRows()[0].trigger('keydown', { key: 'ArrowDown' });
    await dataRows()[1].trigger('keydown', { key: 'ArrowRight' });
    await dataRows()[1].trigger('keydown', { key: 'Delete' });
    const selected = dataRows().filter(
      (item) => item.attributes('aria-selected') === 'true',
    );
    expect(selected.map((item) => item.attributes('aria-label'))).toEqual([
      'Archivo: notas.md',
    ]);
    expect(wrapper.emitted('open')).toBeUndefined();
  });

  it('selects several rows with ctrl+click and opens with Enter', async () => {
    mountList();
    await dataRows()[0].trigger('click');
    await dataRows()[2].trigger('click', { ctrlKey: true });
    const selected = dataRows().filter(
      (item) => item.attributes('aria-selected') === 'true',
    );
    expect(selected).toHaveLength(2);
    await dataRows()[2].trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('open')).toEqual([['nube.bin', false]]);
  });
});

describe('FileList states', () => {
  const BADGES = new Map<string, StateBadge[]>([
    ['carpeta', [CHANGES_BELOW_BADGE]],
    ['notas.md', [localBadge('modified'), localBadge('locked')]],
    ['nube.bin', [NORMAL_BADGE]],
  ]);
  const cellOf = (index: number, column: number) =>
    dataRows()[index].findAll('[role="gridcell"]')[column];

  it('shows every state with its text in the svn column, normal ones included', () => {
    mountList({ columns: ['svn'], badges: BADGES });
    expect(
      cellOf(1, 1)
        .findAll('.svn-badge')
        .map((b) => b.text()),
    ).toEqual(['Modificado', 'Bloqueado']);
    expect(cellOf(2, 1).text()).toBe('Sin cambios');
    expect(cellOf(0, 1).text()).toBe('Contiene cambios');
  });

  it('shows only what changed beside the name when the column is off', () => {
    mountList({ columns: ['type'], badges: BADGES });
    const name = (index: number) => cellOf(index, 0).findAll('.svn-badge');
    expect(name(1).map((b) => b.text())).toEqual(['Modificado', 'Bloqueado']);
    expect(name(2)).toHaveLength(0);
  });

  it('does not repeat the badges beside the name when the column is on', () => {
    mountList({ columns: ['svn'], badges: BADGES });
    expect(cellOf(1, 0).findAll('.svn-badge')).toHaveLength(0);
  });

  it('shows nothing, and no error, while there is no answer', () => {
    mountList({ columns: ['svn'] });
    expect(cellOf(1, 1).text()).toBe('');
    mountList({ mode: 'list' });
    expect(wrapper.findAll('.svn-badge')).toHaveLength(0);
  });

  it('puts the states in the accessible name of the row', () => {
    mountList({ mode: 'list', badges: BADGES });
    expect(dataRows()[1].attributes('aria-label')).toBe(
      'Archivo: notas.md, Modificado, Bloqueado',
    );
    expect(dataRows()[2].attributes('aria-label')).toBe(
      'Archivo: nube.bin, solo en la nube',
    );
  });

  it('sorts by status from the svn header and reports the state', async () => {
    mountList({ columns: ['svn'], sort: 'status', direction: 'asc' });
    const header = wrapper.findAll('[role="columnheader"]')[1];
    expect(header.attributes('aria-sort')).toBe('ascending');
    await header.get('button').trigger('click');
    expect(wrapper.emitted('sort')).toEqual([['status']]);
  });
});
