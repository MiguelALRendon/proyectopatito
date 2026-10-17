import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { WORKSPACE_FILE_ORIGIN, type FileProbe } from '../../services/filesApi';
import ImageViewer from './ImageViewer.vue';

const TextStub = defineComponent({
  emits: ['reprobe'],
  template: `<div id="text-stub" @click="$emit('reprobe')">código</div>`,
});

let wrapper: VueWrapper;

function probe(extra: Partial<FileProbe> = {}): FileProbe {
  return {
    kind: 'image',
    mime: 'image/png',
    len: 68,
    extension: 'png',
    ...extra,
  };
}

function mountViewer(path: string, found: FileProbe = probe()) {
  wrapper = mount(ImageViewer, {
    props: { path, probe: found },
    global: { stubs: { TextEditor: TextStub } },
    attachTo: document.body,
  });
  return wrapper;
}

function button(name: string) {
  return wrapper.findAll('button').find((item) => item.text() === name);
}

const SVG = probe({ mime: 'image/svg+xml', extension: 'svg' });

afterEach(() => wrapper.unmount());

describe('ImageViewer: adversarial', () => {
  it('si la imagen falla cae a la tarjeta binaria con un aviso', async () => {
    mountViewer('wc\\rota.png');
    await wrapper.get('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('article').text()).toContain(
      'No se pudo mostrar la imagen',
    );
    expect(wrapper.text()).toContain('Mostrar hexadecimal');
  });

  it('una imagen que carga pero no decodifica también cae a la tarjeta binaria', async () => {
    mountViewer('wc\\corrupta.png');
    const image = wrapper.get('img').element;
    Object.defineProperty(image, 'decode', {
      value: () => Promise.reject(new Error('EncodingError')),
    });
    await wrapper.get('img').trigger('load');
    await flushPromises();
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('article').text()).toContain(
      'No se pudo mostrar la imagen',
    );
  });

  it('una imagen que decodifica bien se queda y muestra su tamaño', async () => {
    mountViewer('wc\\buena.png');
    const image = wrapper.get('img').element;
    Object.defineProperty(image, 'decode', { value: () => Promise.resolve() });
    Object.defineProperty(image, 'naturalWidth', { value: 32 });
    Object.defineProperty(image, 'naturalHeight', { value: 16 });
    await wrapper.get('img').trigger('load');
    await flushPromises();
    expect(wrapper.find('img').exists()).toBe(true);
    expect(wrapper.get('footer').text()).toContain('32 × 16 px');
  });

  it('un SVG se muestra siempre como imagen, nunca como marcado en línea', () => {
    mountViewer('wc\\vector.svg', SVG);
    expect(wrapper.find('img').exists()).toBe(true);
    expect(wrapper.find('svg:not(.app-icon)').exists()).toBe(false);
    expect(wrapper.find('script').exists()).toBe(false);
  });

  it('un nombre con caracteres especiales viaja codificado al protocolo', () => {
    mountViewer('wc\\a#b%c d ñ.png');
    expect(wrapper.get('img').attributes('src')).toBe(
      `${WORKSPACE_FILE_ORIGIN}/wc/a%23b%25c%20d%20%C3%B1.png`,
    );
  });

  it('una imagen que no es SVG no ofrece «Ver código»', () => {
    mountViewer('wc\\a.png');
    expect(button('Ver código')).toBeUndefined();
  });

  it('el editor de código no se monta hasta pedirlo', () => {
    mountViewer('wc\\vector.svg', SVG);
    expect(wrapper.find('#text-stub').exists()).toBe(false);
  });

  it('reconoce el SVG por el tipo MIME aunque la extensión no lo diga', () => {
    mountViewer('wc\\dibujo.xml', probe({ mime: 'image/svg+xml' }));
    expect(button('Ver código')).toBeDefined();
  });
});

describe('ImageViewer', () => {
  it('«Ver código» abre la vista de texto y «Ver imagen» vuelve', async () => {
    mountViewer('wc\\vector.svg', SVG);
    await button('Ver código')!.trigger('click');
    expect(wrapper.get('#text-stub').isVisible()).toBe(true);
    expect(
      wrapper.get('section[aria-label="Visor de imagen"]').isVisible(),
    ).toBe(false);
    await button('Ver imagen')!.trigger('click');
    expect(
      wrapper.get('section[aria-label="Visor de imagen"]').isVisible(),
    ).toBe(true);
    expect(wrapper.get('#text-stub').isVisible()).toBe(false);
  });

  it('al volver del código la imagen se vuelve a pedir', async () => {
    mountViewer('wc\\vector.svg', SVG);
    const before = wrapper.get('img').attributes('src');
    await button('Ver código')!.trigger('click');
    await button('Ver imagen')!.trigger('click');
    expect(wrapper.get('img').attributes('src')).toBe(`${before}?v=1`);
  });

  it('ajustar a la ventana y 100 % son excluyentes', async () => {
    mountViewer('wc\\a.png');
    expect(button('Ajustar a la ventana')!.attributes('aria-pressed')).toBe(
      'true',
    );
    await button('100 %')!.trigger('click');
    expect(button('100 %')!.attributes('aria-pressed')).toBe('true');
    expect(button('Ajustar a la ventana')!.attributes('aria-pressed')).toBe(
      'false',
    );
    expect(wrapper.get('img').classes()).toContain(
      'image-viewer__image--actual',
    );
  });

  it('la barra de estado muestra tipo y tamaño', () => {
    mountViewer('wc\\a.png');
    expect(wrapper.get('footer').text()).toContain('image/png');
  });

  it('la imagen tiene texto alternativo con el nombre', () => {
    mountViewer('wc\\logo.png');
    expect(wrapper.get('img').attributes('alt')).toBe('Vista de logo.png');
  });
});
