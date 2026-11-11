import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, onMounted, onUnmounted } from 'vue';

vi.mock('./composables/useWindowClose', () => ({ useWindowClose: vi.fn() }));
vi.mock('./composables/useTabsSession', () => ({ useTabsSession: vi.fn() }));
vi.mock('./stores/workspace', () => ({
  useWorkspaceStore: () => ({
    isLoaded: true,
    isOnboarded: true,
    load: vi.fn(),
  }),
}));

import App from './App.vue';

const lifecycle = { mounted: [] as string[], unmounted: [] as string[] };

function tracked(name: string) {
  return defineComponent({
    name,
    setup() {
      onMounted(() => lifecycle.mounted.push(name));
      onUnmounted(() => lifecycle.unmounted.push(name));
      return () => h('div', { 'data-stub': name }, name);
    },
  });
}

const STUBS = Object.fromEntries(
  [
    'ExplorerSidebar',
    'TabBar',
    'TabContent',
    'InfoPanel',
    'RepoList',
    'MarketplaceHome',
    'AboutDialog',
    'ConfirmDialog',
    'ChoiceDialog',
  ].map((name) => [name, tracked(name)]),
);

function mountApp() {
  return mount(App, { global: { stubs: STUBS }, attachTo: document.body });
}

const stub = (wrapper: ReturnType<typeof mountApp>, name: string) =>
  wrapper.find(`[data-stub="${name}"]`);

const goTo = (wrapper: ReturnType<typeof mountApp>, label: string) =>
  wrapper
    .findAll('.shell__nav-item')
    .find((button) => button.text() === label)!
    .trigger('click');

beforeEach(() => {
  lifecycle.mounted = [];
  lifecycle.unmounted = [];
});

describe('App sections', () => {
  it('starts on Mis archivos with the explorer and no marketplace pieces', () => {
    const wrapper = mountApp();
    expect(stub(wrapper, 'TabContent').isVisible()).toBe(true);
    expect(stub(wrapper, 'ExplorerSidebar').isVisible()).toBe(true);
    expect(stub(wrapper, 'RepoList').exists()).toBe(false);
    expect(stub(wrapper, 'MarketplaceHome').exists()).toBe(false);
    wrapper.unmount();
  });

  it('changing section never unmounts the files section (editors, PDF, Office)', async () => {
    const wrapper = mountApp();
    await goTo(wrapper, 'Marketplace');
    await goTo(wrapper, 'Mis archivos');
    await goTo(wrapper, 'Marketplace');
    const kept = ['TabContent', 'ExplorerSidebar', 'TabBar', 'InfoPanel'];
    kept.forEach((name) => {
      expect(lifecycle.unmounted).not.toContain(name);
      expect(stub(wrapper, name).exists()).toBe(true);
    });
    wrapper.unmount();
  });

  it('shows the marketplace pieces and hides the files ones without leaving a strip', async () => {
    const wrapper = mountApp();
    await goTo(wrapper, 'Marketplace');
    expect(stub(wrapper, 'RepoList').isVisible()).toBe(true);
    expect(stub(wrapper, 'MarketplaceHome').isVisible()).toBe(true);
    expect(wrapper.get('[aria-label="Panel inferior"]').text()).toContain(
      'Sin descargas.',
    );
    expect(stub(wrapper, 'TabContent').isVisible()).toBe(false);
    expect(stub(wrapper, 'ExplorerSidebar').isVisible()).toBe(false);
    expect(stub(wrapper, 'InfoPanel').isVisible()).toBe(false);
    expect(wrapper.get('.shell__tabs').isVisible()).toBe(false);
    wrapper.unmount();
  });

  it('coming back restores the files section and drops the marketplace pieces', async () => {
    const wrapper = mountApp();
    await goTo(wrapper, 'Marketplace');
    await goTo(wrapper, 'Mis archivos');
    expect(stub(wrapper, 'TabContent').isVisible()).toBe(true);
    expect(wrapper.get('.shell__tabs').isVisible()).toBe(true);
    expect(stub(wrapper, 'RepoList').exists()).toBe(false);
    expect(wrapper.get('[aria-label="Panel inferior"]').text()).not.toContain(
      'Sin descargas.',
    );
    wrapper.unmount();
  });
});
