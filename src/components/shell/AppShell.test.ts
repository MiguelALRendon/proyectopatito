import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { LAYOUT_STORAGE_PREFIX } from '../../composables/useResizablePanel';
import AppShell from './AppShell.vue';

const SIDEBAR_KEY = `${LAYOUT_STORAGE_PREFIX}sidebar`;
const BOTTOM_KEY = `${LAYOUT_STORAGE_PREFIX}bottom`;

let wrapper: VueWrapper;

function mountShell(slots = {}) {
  wrapper = mount(AppShell, { slots, attachTo: document.body });
  return wrapper;
}

function sectionButton(label: string) {
  return wrapper.findAll('button').find((b) => b.text() === label)!;
}

const files = () => sectionButton('Mis archivos');
const marketplace = () => sectionButton('Marketplace');

function separator(label: string) {
  return wrapper.get(`[role="separator"][aria-label="${label}"]`);
}

beforeEach(() => localStorage.clear());
afterEach(() => wrapper.unmount());

describe('AppShell sections', () => {
  it('starts on Mis archivos with aria-current on that button only', () => {
    mountShell();
    expect(files().attributes('aria-current')).toBe('page');
    expect(marketplace().attributes('aria-current')).toBeUndefined();
  });

  it('switches to Marketplace on click and emits update:section', async () => {
    mountShell();
    await marketplace().trigger('click');
    expect(wrapper.emitted('update:section')).toEqual([['marketplace']]);
    expect(marketplace().attributes('aria-current')).toBe('page');
    expect(files().attributes('aria-current')).toBeUndefined();
  });

  it('goes back to Mis archivos from Marketplace', async () => {
    mountShell();
    await marketplace().trigger('click');
    await files().trigger('click');
    expect(wrapper.emitted('update:section')).toEqual([
      ['marketplace'],
      ['files'],
    ]);
    expect(files().attributes('aria-current')).toBe('page');
  });

  it('follows the section given by its parent', async () => {
    mountShell();
    await wrapper.setProps({ section: 'marketplace' });
    expect(marketplace().attributes('aria-current')).toBe('page');
  });

  it('keeps both buttons enabled and in the tab order', () => {
    mountShell();
    [files(), marketplace()].forEach((button) => {
      expect(button.attributes('disabled')).toBeUndefined();
      expect(button.attributes('aria-disabled')).toBeUndefined();
      expect(button.attributes('tabindex')).toBeUndefined();
    });
  });

  it('switches section by activating the focused native button', async () => {
    mountShell();
    const button = marketplace();
    (button.element as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(button.element);
    (document.activeElement as HTMLButtonElement).click();
    await wrapper.vm.$nextTick();
    expect(marketplace().attributes('aria-current')).toBe('page');
  });

  it('no longer shows the "later phase" notice', () => {
    mountShell();
    expect(wrapper.text()).not.toContain('Disponible en una fase posterior');
  });

  it('hides the tab strip but keeps it mounted on Marketplace', async () => {
    mountShell({ tabs: '<p id="t">pestanas</p>' });
    await marketplace().trigger('click');
    const strip = wrapper.get('.shell__tabs');
    expect(strip.isVisible()).toBe(false);
    expect(strip.find('#t').exists()).toBe(true);
    await files().trigger('click');
    expect(wrapper.get('.shell__tabs').isVisible()).toBe(true);
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
