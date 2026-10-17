import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { LAYOUT_STORAGE_PREFIX } from '../../composables/useResizablePanel';
import AppShell from './AppShell.vue';

const SIDEBAR_KEY = `${LAYOUT_STORAGE_PREFIX}sidebar`;
const BOTTOM_KEY = `${LAYOUT_STORAGE_PREFIX}bottom`;
const NOTICE = 'Disponible en una fase posterior';

let wrapper: VueWrapper;

function mountShell(slots = {}) {
  wrapper = mount(AppShell, { slots, attachTo: document.body });
  return wrapper;
}

function marketplace() {
  return wrapper.findAll('button').find((b) => b.text() === 'Marketplace')!;
}

function separator(label: string) {
  return wrapper.get(`[role="separator"][aria-label="${label}"]`);
}

beforeEach(() => localStorage.clear());
afterEach(() => wrapper.unmount());

describe('AppShell marketplace', () => {
  it('does not fake functionality: aria-disabled and click does nothing', async () => {
    mountShell();
    await marketplace().trigger('click');
    expect(marketplace().attributes('aria-disabled')).toBe('true');
    expect(wrapper.find('[aria-current="page"]').text()).toBe('Mis archivos');
  });

  it('keeps the marketplace button focusable so its notice is announced', () => {
    mountShell();
    expect(marketplace().attributes('disabled')).toBeUndefined();
    expect(marketplace().attributes('tabindex')).toBeUndefined();
  });

  it('shows a visible notice linked by aria-describedby', () => {
    mountShell();
    const noticeId = marketplace().attributes('aria-describedby')!;
    expect(wrapper.get(`#${noticeId}`).text()).toBe(NOTICE);
  });
});

describe('AppShell panels', () => {
  it('ignores a corrupt stored size and uses the default', () => {
    localStorage.setItem(SIDEBAR_KEY, 'no-es-numero');
    mountShell();
    expect(
      separator('Redimensionar la barra lateral').attributes(),
    ).toMatchObject({ 'aria-valuenow': '240' });
  });

  it('clamps a stored size that is out of range', () => {
    localStorage.setItem(BOTTOM_KEY, '99999');
    mountShell();
    expect(
      separator('Redimensionar el panel inferior').attributes(),
    ).toMatchObject({ 'aria-valuenow': '480' });
  });

  it('grows the bottom panel with ArrowUp and remembers it', async () => {
    mountShell();
    await separator('Redimensionar el panel inferior').trigger('keydown', {
      key: 'ArrowUp',
    });
    expect(localStorage.getItem(BOTTOM_KEY)).toBe('176');
    expect(
      wrapper.get('[aria-label="Panel inferior"]').attributes('style'),
    ).toContain('176px');
  });

  it('sets the bottom panel to its limits with End and Home', async () => {
    mountShell();
    const handle = separator('Redimensionar el panel inferior');
    await handle.trigger('keydown', { key: 'End' });
    expect(localStorage.getItem(BOTTOM_KEY)).toBe('480');
    await handle.trigger('keydown', { key: 'Home' });
    expect(localStorage.getItem(BOTTOM_KEY)).toBe('96');
  });

  it('grows the sidebar with ArrowRight and remembers it', async () => {
    mountShell();
    await separator('Redimensionar la barra lateral').trigger('keydown', {
      key: 'ArrowRight',
    });
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('256');
    expect(wrapper.get('aside').attributes('style')).toContain('256px');
  });

  it('restores the sizes of a previous session', () => {
    localStorage.setItem(SIDEBAR_KEY, '300');
    localStorage.setItem(BOTTOM_KEY, '200');
    mountShell();
    expect(wrapper.get('aside').attributes('style')).toContain('300px');
    expect(
      wrapper.get('[aria-label="Panel inferior"]').attributes('style'),
    ).toContain('200px');
  });
});

describe('AppShell structure', () => {
  it('exposes the landmarks nav, aside, main and the bottom region', () => {
    mountShell();
    expect(
      wrapper.find('nav[aria-label="Secciones principales"]').exists(),
    ).toBe(true);
    expect(wrapper.find('aside[aria-label="Barra lateral"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('main').exists()).toBe(true);
    expect(wrapper.find('section[aria-label="Panel inferior"]').exists()).toBe(
      true,
    );
  });

  it('does not render the tabs zone when no tabs are given', () => {
    mountShell();
    expect(wrapper.find('.shell__tabs').exists()).toBe(false);
  });

  it('renders each slot in its own zone', () => {
    mountShell({
      sidebar: '<p id="s">lateral</p>',
      bottom: '<p id="b">inferior</p>',
      tabs: '<p id="t">pestanas</p>',
      content: '<p id="c">contenido</p>',
    });
    expect(wrapper.get('aside #s').text()).toBe('lateral');
    expect(wrapper.get('section #b').text()).toBe('inferior');
    expect(wrapper.get('.shell__tabs #t').text()).toBe('pestanas');
    expect(wrapper.get('main #c').text()).toBe('contenido');
  });
});
