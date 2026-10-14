import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { useFocusTrap } from './useFocusTrap';

const Trap = defineComponent({
  props: { buttons: { type: Array, default: () => ['a', 'b', 'c'] } },
  setup(props) {
    const scope = ref<HTMLElement | null>(null);
    useFocusTrap(scope);
    return () =>
      h(
        'div',
        { ref: scope },
        (props.buttons as string[]).map((id) =>
          h('button', { id, disabled: id.startsWith('off') }, id),
        ),
      );
  },
});

let wrapper: VueWrapper | null = null;

function press(options: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...options,
  });
  document.dispatchEvent(event);
  return event;
}

function mountTrap(buttons?: string[]) {
  wrapper = mount(Trap, { props: { buttons }, attachTo: document.body });
}

function focusById(id: string) {
  document.getElementById(id)?.focus();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('useFocusTrap focus on mount', () => {
  it('moves focus to the first focusable element', () => {
    mountTrap();
    expect(document.activeElement?.id).toBe('a');
  });

  it('skips disabled controls when choosing the first one', () => {
    mountTrap(['off1', 'b']);
    expect(document.activeElement?.id).toBe('b');
  });
});

describe('useFocusTrap Tab cycling', () => {
  it('wraps from the last element to the first', () => {
    mountTrap();
    focusById('c');
    const event = press({ key: 'Tab' });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
  });

  it('wraps backwards from the first element to the last', () => {
    mountTrap();
    focusById('a');
    const event = press({ key: 'Tab', shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('c');
  });

  it('lets Tab move normally inside the dialog', () => {
    mountTrap();
    focusById('b');
    expect(press({ key: 'Tab' }).defaultPrevented).toBe(false);
    expect(press({ key: 'Tab', shiftKey: true }).defaultPrevented).toBe(false);
  });

  it('does not treat Shift+Tab on the last element or Tab on the first as leaving', () => {
    mountTrap();
    focusById('c');
    expect(press({ key: 'Tab', shiftKey: true }).defaultPrevented).toBe(false);
    focusById('a');
    expect(press({ key: 'Tab' }).defaultPrevented).toBe(false);
  });

  it('ignores keys other than Tab', () => {
    mountTrap();
    focusById('c');
    expect(press({ key: 'Enter' }).defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe('c');
  });

  it('does nothing when there is nothing focusable', () => {
    mountTrap([]);
    expect(press({ key: 'Tab' }).defaultPrevented).toBe(false);
  });

  it('stops trapping after it is unmounted', () => {
    mountTrap();
    focusById('c');
    wrapper?.unmount();
    wrapper = null;
    expect(press({ key: 'Tab' }).defaultPrevented).toBe(false);
  });
});

describe('useFocusTrap focus restoration', () => {
  function openFrom(opener: HTMLElement) {
    document.body.append(opener);
    opener.focus();
    mountTrap();
    expect(document.activeElement?.id).toBe('a');
    wrapper?.unmount();
    wrapper = null;
  }

  it('returns focus to the element that had it before opening', () => {
    const opener = document.createElement('button');
    opener.id = 'opener';
    openFrom(opener);
    expect(document.activeElement?.id).toBe('opener');
  });

  it('falls back to <main> when the opener was removed', () => {
    const main = document.createElement('main');
    main.tabIndex = -1;
    document.body.append(main);
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    mountTrap();
    opener.remove();
    wrapper?.unmount();
    wrapper = null;
    expect(document.activeElement).toBe(main);
  });

  it('falls back to <main> when the opener is disabled by then', () => {
    const main = document.createElement('main');
    main.tabIndex = -1;
    document.body.append(main);
    const opener = document.createElement('button');
    opener.id = 'opener';
    document.body.append(opener);
    opener.focus();
    mountTrap();
    opener.disabled = true;
    wrapper?.unmount();
    wrapper = null;
    expect(document.activeElement).toBe(main);
  });

  it('falls back to <main> when nothing was focused before opening', () => {
    const main = document.createElement('main');
    main.tabIndex = -1;
    document.body.append(main);
    mountTrap();
    wrapper?.unmount();
    wrapper = null;
    expect(document.activeElement).toBe(main);
  });
});
