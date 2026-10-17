import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { DOCUMENT_TAB_KEY, useDocumentTab } from './tabContext';

const Reader = defineComponent({
  setup() {
    return () => h('span', useDocumentTab());
  },
});

describe('useDocumentTab', () => {
  it('entrega la pestaña que provee el anfitrión del documento', () => {
    const wrapper = mount(Reader, {
      global: { provide: { [DOCUMENT_TAB_KEY as symbol]: 'tab-7' } },
    });
    expect(wrapper.text()).toBe('tab-7');
  });

  it('falla con un mensaje claro si no hay pestaña en el contexto', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => mount(Reader)).toThrow('necesita una pestaña de documento');
    warn.mockRestore();
  });

  it('una pestaña vacía tampoco es válida', () => {
    expect(() =>
      mount(Reader, {
        global: { provide: { [DOCUMENT_TAB_KEY as symbol]: '' } },
      }),
    ).toThrow('necesita una pestaña de documento');
  });
});
