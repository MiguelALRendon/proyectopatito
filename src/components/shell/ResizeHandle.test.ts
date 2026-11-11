import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ResizeHandle from './ResizeHandle.vue';

const props = { label: 'Panel', value: 200, min: 100, max: 300 };

function press(wrapper: ReturnType<typeof mount>, key: string) {
  return wrapper.trigger('keydown', { key });
}

describe('ResizeHandle keyboard', () => {
  it.each(['Enter', 'a', 'PageUp', 'constructor'])(
    'ignores the key %s',
    async (key) => {
      const wrapper = mount(ResizeHandle, { props });
      await press(wrapper, key);
      expect(wrapper.emitted('nudge')).toBeUndefined();
    },
  );

  it('ignores the vertical keys on a vertical separator', async () => {
    const wrapper = mount(ResizeHandle, { props });
    await press(wrapper, 'ArrowUp');
    await press(wrapper, 'ArrowDown');
    expect(wrapper.emitted('nudge')).toBeUndefined();
  });

  it('ignores the horizontal keys on a horizontal separator', async () => {
    const wrapper = mount(ResizeHandle, {
      props: { ...props, orientation: 'horizontal' },
    });
    await press(wrapper, 'ArrowLeft');
    await press(wrapper, 'ArrowRight');
    expect(wrapper.emitted('nudge')).toBeUndefined();
  });

  it('prevents the default scroll of the keys it handles', async () => {
    const wrapper = mount(ResizeHandle, { props });
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      cancelable: true,
    });
    wrapper.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('jumps to the minimum with Home and the maximum with End', async () => {
    const wrapper = mount(ResizeHandle, { props });
    await press(wrapper, 'Home');
    await press(wrapper, 'End');
    expect(wrapper.emitted('jump')).toEqual([[100], [300]]);
    expect(wrapper.emitted('nudge')).toBeUndefined();
  });

  it('prevents the default scroll of Home and End', () => {
    const wrapper = mount(ResizeHandle, { props });
    for (const key of ['Home', 'End']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      wrapper.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('ignores End and leaves the key alone when there is no maximum', () => {
    const wrapper = mount(ResizeHandle, {
      props: { label: 'Panel', value: 200, min: 100 },
    });
    const event = new KeyboardEvent('keydown', {
      key: 'End',
      cancelable: true,
    });
    wrapper.element.dispatchEvent(event);
    expect(wrapper.emitted('jump')).toBeUndefined();
    expect(event.defaultPrevented).toBe(false);
  });

  it('emits a negative then positive step with left and right', async () => {
    const wrapper = mount(ResizeHandle, { props });
    await press(wrapper, 'ArrowLeft');
    await press(wrapper, 'ArrowRight');
    expect(wrapper.emitted('nudge')).toEqual([[-16], [16]]);
  });

  it('emits a negative then positive step with up and down when horizontal', async () => {
    const wrapper = mount(ResizeHandle, {
      props: { ...props, orientation: 'horizontal' },
    });
    await press(wrapper, 'ArrowUp');
    await press(wrapper, 'ArrowDown');
    expect(wrapper.emitted('nudge')).toEqual([[-16], [16]]);
  });
});

describe('ResizeHandle accessibility and pointer', () => {
  it('omits aria-valuemax when there is no maximum', () => {
    const wrapper = mount(ResizeHandle, {
      props: { label: 'Panel', value: 200, min: 100 },
    });
    expect(wrapper.attributes('aria-valuemax')).toBeUndefined();
  });

  it('exposes a focusable separator with its value and limits', () => {
    const wrapper = mount(ResizeHandle, { props });
    expect(wrapper.attributes()).toMatchObject({
      role: 'separator',
      tabindex: '0',
      'aria-label': 'Panel',
      'aria-orientation': 'vertical',
      'aria-valuenow': '200',
      'aria-valuemin': '100',
      'aria-valuemax': '300',
    });
  });

  it('reports the horizontal orientation', () => {
    const wrapper = mount(ResizeHandle, {
      props: { ...props, orientation: 'horizontal' },
    });
    expect(wrapper.attributes('aria-orientation')).toBe('horizontal');
  });

  it('forwards the pointer down to start a drag', async () => {
    const wrapper = mount(ResizeHandle, { props });
    await wrapper.trigger('pointerdown');
    expect(wrapper.emitted('drag')).toHaveLength(1);
  });
});
