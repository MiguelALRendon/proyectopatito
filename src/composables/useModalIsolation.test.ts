import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { Teleport, defineComponent, h, ref } from 'vue';
import { useModalIsolation } from './useModalIsolation';

const Modal = defineComponent({
  props: { withOverlay: { type: Boolean, default: true } },
  setup(props) {
    const overlay = ref<HTMLElement | null>(null);
    useModalIsolation(overlay);
    return () =>
      h(Teleport, { to: 'body' }, [
        props.withOverlay
          ? h('div', { ref: overlay, class: 'overlay' })
          : h('span'),
      ]);
  },
});

const opened: VueWrapper[] = [];

function openModal(props: { withOverlay?: boolean } = {}) {
  const modal = mount(Modal, { props });
  opened.push(modal);
  return modal;
}

function addSibling(tag: string, attributes: Record<string, string> = {}) {
  const element = document.createElement(tag);
  Object.entries(attributes).forEach(([name, value]) =>
    element.setAttribute(name, value),
  );
  document.body.append(element);
  return element;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

afterEach(() => {
  opened.splice(0).forEach((modal) => modal.unmount());
});

describe('useModalIsolation', () => {
  it('makes the rest of the page inert but never the overlay or scripts', () => {
    const page = addSibling('main');
    const script = addSibling('script');
    openModal();
    expect(page.hasAttribute('inert')).toBe(true);
    expect(script.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('.overlay')?.hasAttribute('inert')).toBe(
      false,
    );
  });

  it('restores the page when the modal closes', () => {
    const page = addSibling('main');
    const modal = openModal();
    modal.unmount();
    opened.length = 0;
    expect(page.hasAttribute('inert')).toBe(false);
  });

  it('leaves inert what was already inert before opening', () => {
    const already = addSibling('aside', { inert: '' });
    const modal = openModal();
    modal.unmount();
    opened.length = 0;
    expect(already.hasAttribute('inert')).toBe(true);
  });

  it('locks scrolling while any modal is open and unlocks after the last one', () => {
    const first = openModal();
    const second = openModal();
    expect(document.body.classList.contains('modal-open')).toBe(true);
    first.unmount();
    expect(document.body.classList.contains('modal-open')).toBe(true);
    second.unmount();
    opened.length = 0;
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('does nothing when the overlay element is missing', () => {
    const page = addSibling('main');
    openModal({ withOverlay: false });
    expect(page.hasAttribute('inert')).toBe(false);
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });
});
