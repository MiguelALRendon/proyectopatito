import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { STATE_LEGEND } from '../../utils/svnLabels';
import { localBadge, type StateBadge } from '../../utils/svnBadges';
import SvnStateBadge from './SvnStateBadge.vue';

const render = (badge: StateBadge) =>
  mount(SvnStateBadge, { props: { badge } });

describe('SvnStateBadge', () => {
  it('shows the text of the state, not only a color', () => {
    const wrapper = render(localBadge('conflicted'));
    expect(wrapper.text()).toBe('En conflicto');
  });

  it('draws a shape that is hidden from assistive technology, because the text says it', () => {
    const wrapper = render(localBadge('modified'));
    const icon = wrapper.get('svg');
    expect(icon.attributes('aria-hidden')).toBe('true');
    expect(icon.findAll('path').length).toBeGreaterThan(0);
  });

  it('tells the state apart for styling and tests with its key and tone', () => {
    const wrapper = render(localBadge('deleted'));
    expect(wrapper.attributes('data-state')).toBe('deleted');
    expect(wrapper.classes()).toContain('svn-badge--danger');
  });

  it('renders every state of the legend with text and a shape', () => {
    STATE_LEGEND.forEach(({ key }) => {
      const wrapper = render(localBadge(key));
      expect(wrapper.text().trim()).not.toBe('');
      expect(wrapper.findAll('svg path').length).toBeGreaterThan(0);
    });
  });
});
