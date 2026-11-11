import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';

vi.mock('../../documents/markdown/render', () => ({
  renderMarkdown: vi.fn(
    (source: string) =>
      `<h1>Título</h1><a title="destino">enlace <b>fuerte</b></a><img src="http://workspace-file.localhost/a.png" alt="foto"><p>${source}</p>`,
  ),
  imagePlaceholder: vi.fn((image: HTMLImageElement, label: string) => {
    const placeholder = document.createElement('span');
    placeholder.textContent = `${label}: ${image.alt}`;
    return placeholder;
  }),
}));

import { renderMarkdown } from '../../documents/markdown/render';
import MarkdownPreview from './MarkdownPreview.vue';

let wrapper: VueWrapper;

function mountPreview(source = 'hola') {
  wrapper = mount(MarkdownPreview, {
    props: { source, baseDirectory: 'wc' },
    attachTo: document.body,
  });
  return wrapper;
}

afterEach(() => wrapper.unmount());

describe('MarkdownPreview: adversarial', () => {
  it('un clic dentro de un enlace no navega', () => {
    mountPreview();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    wrapper.get('a').element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('un clic en el contenido de un enlace tampoco navega', () => {
    mountPreview();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    wrapper.get('a b').element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('el clic central sobre un enlace no navega', () => {
    mountPreview();
    const auxclick = new MouseEvent('auxclick', {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    wrapper.get('a').element.dispatchEvent(auxclick);
    expect(auxclick.defaultPrevented).toBe(true);
  });

  it('un clic fuera de los enlaces no se cancela', () => {
    mountPreview();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    wrapper.get('p').element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it('una imagen del protocolo que no carga se sustituye por un aviso', () => {
    mountPreview();
    wrapper.get('img').element.dispatchEvent(new Event('error'));
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('Imagen no encontrada: foto');
  });

  it('un error que no viene de una imagen no cambia nada', () => {
    mountPreview();
    wrapper.get('p').element.dispatchEvent(new Event('error'));
    expect(wrapper.find('img').exists()).toBe(true);
  });
});

describe('MarkdownPreview', () => {
  it('es una región enfocable con nombre, para leerla con teclado', () => {
    mountPreview();
    const region = wrapper.get('[role="region"]');
    expect(region.attributes('aria-label')).toBe('Vista previa de Markdown');
    expect(region.attributes('tabindex')).toBe('0');
  });

  it('muestra lo que devuelve el saneador con la carpeta del documento', () => {
    mountPreview('texto en vivo');
    expect(wrapper.get('h1').text()).toBe('Título');
    expect(renderMarkdown).toHaveBeenCalledWith('texto en vivo', 'wc');
  });

  it('se actualiza con el texto nuevo', async () => {
    mountPreview('uno');
    await wrapper.setProps({ source: 'dos' });
    expect(wrapper.get('p').text()).toBe('dos');
  });
});
