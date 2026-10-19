import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../services/filesApi', () => ({
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
}));
vi.mock('../../composables/useConfirm', () => ({ confirm: vi.fn() }));
vi.mock('../documents/DocumentHost.vue', () => ({
  default: {
    props: ['path'],
    template: '<section id="host-stub">{{ path }}</section>',
  },
}));
vi.mock('../explorer/FolderExplorer.vue', () => ({
  default: {
    props: ['tabId'],
    template: '<section id="explorer-stub">{{ tabId }}</section>',
  },
}));

import { uiStateGet, type UiStateView } from '../../services/filesApi';
import { useOfficeStore } from '../../stores/office';
import { useTabsStore } from '../../stores/tabs';
import TabContent from './TabContent.vue';

let wrapper: VueWrapper;

function mountContent() {
  setActivePinia(createPinia());
  const store = useTabsStore();
  wrapper = mount(TabContent);
  return store;
}

afterEach(() => wrapper.unmount());

describe('TabContent', () => {
  it('invites the user to open a tab when none is open', async () => {
    const store = mountContent();
    expect(wrapper.text()).toContain('No hay pestañas abiertas');
    await wrapper.get('button').trigger('click');
    expect(store.tabs).toHaveLength(1);
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(true);
  });

  it('shows a loading status instead of the invitation while the session is restored', async () => {
    let finish: (view: UiStateView) => void = () => undefined;
    vi.mocked(uiStateGet).mockReturnValue(
      new Promise<UiStateView>((done) => (finish = done)),
    );
    const store = mountContent();
    const pending = store.restore();
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[role="status"]').text()).toBe('Cargando…');
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('No hay pestañas abiertas');
    finish({
      version: 1,
      tabs: [],
      active_tab: null,
      favorites: [],
      views: {},
    });
    await pending;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('[role="tabpanel"]').exists()).toBe(true);
  });

  it('mounts the explorer of the active tab for a folder tab', async () => {
    const store = mountContent();
    store.open('a');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('#explorer-stub').text()).toBe(store.activeId);
  });

  it('gives each folder tab its own explorer instance', async () => {
    const store = mountContent();
    const first = store.open('a') as string;
    await wrapper.vm.$nextTick();
    const second = store.open('b') as string;
    await wrapper.vm.$nextTick();
    expect(wrapper.get('#explorer-stub').text()).toBe(second);
    store.activate(first);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('#explorer-stub').text()).toBe(first);
  });

  it('mounts the document host with the path of a document tab', async () => {
    const store = mountContent();
    store.open('a/readme.md', 'document');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('#explorer-stub').exists()).toBe(false);
    expect(wrapper.get('#host-stub').text()).toBe('a\\readme.md');
  });

  it('gives each document tab its own host instance', async () => {
    const store = mountContent();
    const first = store.open('a/uno.txt', 'document') as string;
    await wrapper.vm.$nextTick();
    store.open('a/dos.txt', 'document');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('#host-stub').text()).toBe('a\\dos.txt');
    store.activate(first);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('#host-stub').text()).toBe('a\\uno.txt');
  });

  it('labels the tab panel by the active tab', async () => {
    const store = mountContent();
    const id = store.open('a') as string;
    await wrapper.vm.$nextTick();
    const panel = wrapper.get('[role="tabpanel"]');
    expect(panel.attributes('id')).toBe('tab-panel');
    expect(panel.attributes('aria-labelledby')).toBe(`tab-${id}`);
  });
});

describe('TabContent con un documento de Office vivo', () => {
  function liveOffice() {
    const store = mountContent();
    const office = useOfficeStore();
    const folder = store.open('wc', 'folder') as string;
    const document = store.open('wc\\informe.docx', 'document') as string;
    office.attach({
      tabId: document,
      path: 'wc\\informe.docx',
      docId: 'doc-1',
      ext: 'docx',
      kind: 'writer',
      version: 'v1',
    });
    return { store, office, folder, document };
  }

  it('al ir a otra pestaña el documento vivo sigue montado, oculto y sin recrearse', async () => {
    const { store, folder } = liveOffice();
    await wrapper.vm.$nextTick();
    const before = wrapper.get('#host-stub').element;
    store.activate(folder);
    await wrapper.vm.$nextTick();
    const panes = wrapper.findAll('.tab-content__pane');
    expect(panes).toHaveLength(2);
    expect(wrapper.get('#host-stub').element).toBe(before);
    const hidden = panes.filter((pane) =>
      pane.attributes('style')?.includes('display: none'),
    );
    expect(hidden).toHaveLength(1);
    expect(hidden[0].find('#host-stub').exists()).toBe(true);
    expect(wrapper.get('#explorer-stub').isVisible()).toBe(true);
  });

  it('al volver al documento solo queda ese panel y es el mismo elemento', async () => {
    const { store, folder, document } = liveOffice();
    await wrapper.vm.$nextTick();
    const before = wrapper.get('#host-stub').element;
    store.activate(folder);
    await wrapper.vm.$nextTick();
    store.activate(document);
    await wrapper.vm.$nextTick();
    expect(wrapper.get('#host-stub').element).toBe(before);
    expect(wrapper.get('#host-stub').isVisible()).toBe(true);
  });

  it('sin documento vivo, al cambiar de pestaña solo existe la activa', async () => {
    const store = mountContent();
    const folder = store.open('wc', 'folder') as string;
    store.open('wc\\notas.txt', 'document');
    await wrapper.vm.$nextTick();
    store.activate(folder);
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.tab-content__pane')).toHaveLength(1);
    expect(wrapper.find('#host-stub').exists()).toBe(false);
  });

  it('al soltar el documento vivo desaparece su panel oculto', async () => {
    const { store, office, folder, document } = liveOffice();
    store.activate(folder);
    await wrapper.vm.$nextTick();
    office.detach(document);
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.tab-content__pane')).toHaveLength(1);
  });
});
