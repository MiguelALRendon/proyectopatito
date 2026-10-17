import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import BreadcrumbBar from './BreadcrumbBar.vue';

function crumbs(path: string) {
  return mount(BreadcrumbBar, { props: { path } });
}

const labels = (wrapper: ReturnType<typeof crumbs>) =>
  wrapper.findAll('button').map((button) => button.text());

describe('BreadcrumbBar', () => {
  it('shows only the workspace root at the root', () => {
    const wrapper = crumbs('');
    expect(labels(wrapper)).toEqual(['Mis archivos']);
    expect(wrapper.get('button').attributes('aria-current')).toBe('page');
  });

  it('marks only the last crumb as the current page', () => {
    const wrapper = crumbs('a\\b');
    const current = wrapper
      .findAll('button')
      .filter((button) => button.attributes('aria-current') === 'page');
    expect(current.map((button) => button.text())).toEqual(['b']);
  });

  it('hides the separators from assistive technology', () => {
    const wrapper = crumbs('a\\b');
    const separators = wrapper.findAll('.breadcrumb-bar__separator');
    expect(separators).toHaveLength(2);
    separators.forEach((item) => {
      expect(item.attributes('aria-hidden')).toBe('true');
    });
  });

  it('navigates to the clicked crumb and to the root', async () => {
    const wrapper = crumbs('a\\b\\c');
    await wrapper.findAll('button')[2].trigger('click');
    await wrapper.findAll('button')[0].trigger('click');
    expect(wrapper.emitted('navigate')).toEqual([
      ['a\\b', false],
      ['', false],
    ]);
  });

  it('asks for a new tab with ctrl+click and with the middle button, only', async () => {
    const wrapper = crumbs('a\\b');
    const crumb = wrapper.findAll('button')[1];
    await crumb.trigger('click', { ctrlKey: true });
    await crumb.trigger('auxclick', { button: 1 });
    await crumb.trigger('auxclick', { button: 2 });
    expect(wrapper.emitted('navigate')).toEqual([
      ['a', true],
      ['a', true],
    ]);
  });
});
