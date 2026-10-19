import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../services/filesApi', () => ({
  fsReadText: vi.fn(),
  fsWriteText: vi.fn(),
}));
vi.mock('../../documents/markdown/render', () => ({
  renderMarkdown: vi.fn((source: string) => `<p>${source}</p>`),
  imagePlaceholder: vi.fn(),
}));

import { DOCUMENT_TAB_KEY } from '../../documents/tabContext';
import type { FileProbe } from '../../services/filesApi';
import { useDocumentsStore } from '../../stores/documents';
import MarkdownEditor from './MarkdownEditor.vue';

const TextStub = defineComponent({
  emits: ['reprobe'],
  template: `<div id="text-stub" @click="$emit('reprobe')">editor</div>`,
});
const TAB_ID = 'tab-md';
const PROBE: FileProbe = {
  kind: 'text',
  mime: 'text/markdown',
  len: 5,
  extension: null,
  has_macros: false,
  version: null,
};

type FakeSession = { phase: string; current: string } | null;

let wrapper: VueWrapper;

function provideSession(session: FakeSession) {
  const store = useDocumentsStore();
  store.sessionOf = () => session as ReturnType<typeof store.sessionOf>;
}

function mountEditor(path = 'wc\\docs\\a.md') {
  wrapper = mount(MarkdownEditor, {
    props: { path, probe: PROBE },
    global: {
      stubs: { TextEditor: TextStub },
      provide: { [DOCUMENT_TAB_KEY as symbol]: TAB_ID },
    },
    attachTo: document.body,
  });
  return wrapper;
}

function modeButton(name: string) {
  return wrapper.findAll('button').find((button) => button.text() === name)!;
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => wrapper.unmount());

describe('MarkdownEditor: adversarial', () => {
  it('mientras el documento no está abierto no ofrece modos ni vista previa', () => {
    provideSession({ phase: 'loading', current: '' });
    mountEditor();
    expect(wrapper.find('[role="group"]').exists()).toBe(false);
    expect(wrapper.find('[role="region"]').exists()).toBe(false);
    expect(wrapper.get('#text-stub').isVisible()).toBe(true);
  });

  it('sin sesión tampoco rompe', () => {
    provideSession(null);
    mountEditor();
    expect(wrapper.find('[role="group"]').exists()).toBe(false);
  });

  it('un documento fallido (binario) deja siempre visible el editor y su tarjeta', () => {
    provideSession({ phase: 'failed', current: '' });
    mountEditor();
    expect(wrapper.find('[role="group"]').exists()).toBe(false);
    expect(wrapper.get('#text-stub').isVisible()).toBe(true);
  });

  it('en vista previa el editor sigue montado pero oculto, para no perder cambios', async () => {
    provideSession({ phase: 'ready', current: 'x' });
    mountEditor();
    await modeButton('Vista previa').trigger('click');
    expect(wrapper.find('#text-stub').exists()).toBe(true);
    expect(wrapper.get('#text-stub').isVisible()).toBe(false);
  });

  it('el aviso de recarga del editor sube al anfitrión', async () => {
    provideSession({ phase: 'ready', current: 'x' });
    mountEditor();
    await wrapper.get('#text-stub').trigger('click');
    expect(wrapper.emitted('reprobe')).toHaveLength(1);
  });
});

describe('MarkdownEditor', () => {
  it('abre en modo Editor, sin vista previa', () => {
    provideSession({ phase: 'ready', current: '# Hola' });
    mountEditor();
    expect(modeButton('Editor').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('[role="region"]').exists()).toBe(false);
    expect(wrapper.get('#text-stub').isVisible()).toBe(true);
  });

  it('Vista previa muestra solo la vista previa con el texto actual', async () => {
    provideSession({ phase: 'ready', current: 'texto vivo' });
    mountEditor();
    await modeButton('Vista previa').trigger('click');
    expect(modeButton('Vista previa').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[role="region"]').text()).toBe('texto vivo');
    expect(wrapper.find('[role="separator"]').exists()).toBe(false);
  });

  it('Dividido muestra editor, separador redimensionable y vista previa', async () => {
    provideSession({ phase: 'ready', current: 'x' });
    mountEditor();
    await modeButton('Dividido').trigger('click');
    expect(wrapper.get('#text-stub').isVisible()).toBe(true);
    expect(wrapper.find('[role="separator"]').exists()).toBe(true);
    expect(wrapper.find('[role="region"]').exists()).toBe(true);
  });

  it('volver a Editor quita la vista previa y el separador', async () => {
    provideSession({ phase: 'ready', current: 'x' });
    mountEditor();
    await modeButton('Dividido').trigger('click');
    await modeButton('Editor').trigger('click');
    expect(wrapper.find('[role="separator"]').exists()).toBe(false);
    expect(wrapper.find('[role="region"]').exists()).toBe(false);
  });

  it('los tres modos tienen nombre accesible y solo uno está pulsado', () => {
    provideSession({ phase: 'ready', current: 'x' });
    mountEditor();
    const buttons = wrapper.get('[role="group"]').findAll('button');
    expect(buttons.map((button) => button.text())).toEqual([
      'Editor',
      'Vista previa',
      'Dividido',
    ]);
    expect(
      buttons.filter((button) => button.attributes('aria-pressed') === 'true'),
    ).toHaveLength(1);
  });

  it('la vista previa recibe la carpeta del documento', async () => {
    const { renderMarkdown } = await import('../../documents/markdown/render');
    provideSession({ phase: 'ready', current: 'x' });
    mountEditor('wc\\docs\\a.md');
    await modeButton('Vista previa').trigger('click');
    expect(renderMarkdown).toHaveBeenLastCalledWith('x', 'wc\\docs');
  });
});
