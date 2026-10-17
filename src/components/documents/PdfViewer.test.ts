import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { FileProbe } from '../../services/filesApi';

const loader = vi.hoisted(() => ({
  openPdf: vi.fn(),
  failureOf: vi.fn(),
}));
vi.mock('../../documents/pdf/loader', () => loader);

import PdfViewer from './PdfViewer.vue';

const PROBE: FileProbe = {
  kind: 'pdf',
  mime: 'application/pdf',
  len: 1000,
  extension: 'pdf',
};

let wrapper: VueWrapper;

function fakeHandle(pageCount = 3) {
  const render = vi.fn(() => ({
    done: Promise.resolve(),
    cancel: vi.fn(),
  }));
  return {
    pageCount,
    pageSize: vi.fn(async () => ({ width: 600, height: 800 })),
    render,
    destroy: vi.fn(async () => undefined),
  };
}

async function mountViewer(handle = fakeHandle(), path = 'wc\\doc.pdf') {
  loader.openPdf.mockResolvedValue(handle);
  wrapper = mount(PdfViewer, {
    props: { path, probe: PROBE },
    attachTo: document.body,
  });
  await flushPromises();
  return handle;
}

function button(label: string) {
  return wrapper.get(`button[aria-label="${label}"]`);
}

beforeEach(() => {
  loader.openPdf.mockReset();
  loader.failureOf.mockReset();
});

afterEach(() => wrapper.unmount());

describe('PdfViewer: adversarial', () => {
  it('un PDF dañado cae a la tarjeta binaria con su aviso', async () => {
    loader.openPdf.mockRejectedValue(new Error('roto'));
    loader.failureOf.mockReturnValue('damaged');
    wrapper = mount(PdfViewer, { props: { path: 'wc\\x.pdf', probe: PROBE } });
    await flushPromises();
    expect(wrapper.get('article').text()).toContain('dañado');
    expect(wrapper.text()).toContain('Mostrar hexadecimal');
  });

  it('un PDF con contraseña lo dice y cae a binario', async () => {
    loader.openPdf.mockRejectedValue(new Error('pass'));
    loader.failureOf.mockReturnValue('password');
    wrapper = mount(PdfViewer, { props: { path: 'wc\\x.pdf', probe: PROBE } });
    await flushPromises();
    expect(wrapper.get('article').text()).toContain('contraseña');
  });

  it('no se puede ir antes de la primera ni después de la última página', async () => {
    await mountViewer(fakeHandle(2));
    expect(button('Página anterior').attributes('disabled')).toBeDefined();
    await button('Página siguiente').trigger('click');
    expect(button('Página siguiente').attributes('disabled')).toBeDefined();
    expect(wrapper.get('footer').text()).toContain('Página 2 de 2');
  });

  it.each(['abc', '', '-4', '1.5'])(
    'un número de página inválido (%j) conserva la página actual',
    async (text) => {
      await mountViewer();
      await button('Página siguiente').trigger('click');
      const input = wrapper.get('input[aria-label="Número de página"]');
      await input.setValue(text);
      await input.trigger('change');
      expect(wrapper.get('footer').text()).toContain('Página 2 de 3');
      expect((input.element as HTMLInputElement).value).toBe('2');
    },
  );

  it('un número fuera de rango se recorta a la última página', async () => {
    await mountViewer();
    const input = wrapper.get('input[aria-label="Número de página"]');
    await input.setValue('99');
    await input.trigger('change');
    expect(wrapper.get('footer').text()).toContain('Página 3 de 3');
  });

  it('las teclas de página no hacen nada con Ctrl', async () => {
    await mountViewer();
    await wrapper
      .get('[role="region"]')
      .trigger('keydown', { key: 'PageDown', ctrlKey: true });
    expect(wrapper.get('footer').text()).toContain('Página 1 de 3');
  });

  it('una tecla que no es del visor no se cancela', async () => {
    await mountViewer();
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });
    wrapper.get('[role="region"]').element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('al desmontar libera el documento', async () => {
    const handle = await mountViewer();
    wrapper.unmount();
    expect(handle.destroy).toHaveBeenCalled();
    wrapper = mount(PdfViewer, { props: { path: 'wc\\y.pdf', probe: PROBE } });
  });
});

function deferredOpen() {
  let resolve: (handle: ReturnType<typeof fakeHandle>) => void = () =>
    undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<ReturnType<typeof fakeHandle>>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('PdfViewer: carreras al abrir', () => {
  it('desmontar con la apertura pendiente destruye el documento al llegar', async () => {
    const pending = deferredOpen();
    loader.openPdf.mockReturnValue(pending.promise);
    wrapper = mount(PdfViewer, { props: { path: 'wc\\a.pdf', probe: PROBE } });
    await flushPromises();
    wrapper.unmount();
    const handle = fakeHandle();
    pending.resolve(handle);
    await flushPromises();
    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(handle.render).not.toHaveBeenCalled();
  });

  it('cambiar de ruta con la apertura pendiente destruye el documento atrasado', async () => {
    const first = deferredOpen();
    const second = deferredOpen();
    loader.openPdf
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    wrapper = mount(PdfViewer, { props: { path: 'wc\\a.pdf', probe: PROBE } });
    await flushPromises();
    await wrapper.setProps({ path: 'wc\\b.pdf' });
    await flushPromises();
    const handleB = fakeHandle();
    second.resolve(handleB);
    await flushPromises();
    const handleA = fakeHandle();
    first.resolve(handleA);
    await flushPromises();
    expect(handleA.destroy).toHaveBeenCalledTimes(1);
    expect(handleA.render).not.toHaveBeenCalled();
    expect(handleB.destroy).not.toHaveBeenCalled();
    expect(handleB.render).toHaveBeenCalled();
  });

  it('el documento anterior que llega primero tampoco se queda con la vista', async () => {
    const first = deferredOpen();
    const second = deferredOpen();
    loader.openPdf
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    wrapper = mount(PdfViewer, { props: { path: 'wc\\a.pdf', probe: PROBE } });
    await flushPromises();
    await wrapper.setProps({ path: 'wc\\b.pdf' });
    await flushPromises();
    const handleA = fakeHandle();
    first.resolve(handleA);
    await flushPromises();
    const handleB = fakeHandle();
    second.resolve(handleB);
    await flushPromises();
    expect(handleA.destroy).toHaveBeenCalledTimes(1);
    expect(handleB.destroy).not.toHaveBeenCalled();
    expect(wrapper.get('footer').text()).toContain('de 3');
  });

  it('un fallo atrasado de la apertura anterior no tumba la vista nueva', async () => {
    const first = deferredOpen();
    const second = deferredOpen();
    loader.openPdf
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    loader.failureOf.mockReturnValue('damaged');
    wrapper = mount(PdfViewer, { props: { path: 'wc\\a.pdf', probe: PROBE } });
    await flushPromises();
    await wrapper.setProps({ path: 'wc\\b.pdf' });
    await flushPromises();
    second.resolve(fakeHandle());
    await flushPromises();
    first.reject(new Error('tarde'));
    await flushPromises();
    expect(wrapper.text()).not.toContain('dañado');
    expect(loader.failureOf).not.toHaveBeenCalled();
  });
});

describe('PdfViewer', () => {
  it('pinta la primera página al abrir', async () => {
    const handle = await mountViewer();
    expect(handle.render).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
    );
    expect(wrapper.get('footer').text()).toContain('Página 1 de 3');
  });

  it('pasar de página vuelve a pintar la página nueva', async () => {
    const handle = await mountViewer();
    await button('Página siguiente').trigger('click');
    await flushPromises();
    expect(handle.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });

  it('PageDown, PageUp, End y Home navegan con el teclado', async () => {
    await mountViewer();
    const region = wrapper.get('[role="region"]');
    await region.trigger('keydown', { key: 'End' });
    expect(wrapper.get('footer').text()).toContain('Página 3 de 3');
    await region.trigger('keydown', { key: 'PageUp' });
    expect(wrapper.get('footer').text()).toContain('Página 2 de 3');
    await region.trigger('keydown', { key: 'Home' });
    expect(wrapper.get('footer').text()).toContain('Página 1 de 3');
    await region.trigger('keydown', { key: 'PageDown' });
    expect(wrapper.get('footer').text()).toContain('Página 2 de 3');
  });

  it('acercar y alejar recorren los pasos de zoom', async () => {
    await mountViewer();
    await button('Acercar').trigger('click');
    const first = wrapper.get('[aria-label="Zoom actual"]').text();
    await button('Acercar').trigger('click');
    const second = wrapper.get('[aria-label="Zoom actual"]').text();
    expect(second).not.toBe(first);
    await button('Alejar').trigger('click');
    expect(wrapper.get('[aria-label="Zoom actual"]').text()).toBe(first);
  });

  it('abre al 100 % y «Ajustar al ancho» lo cambia y se puede abandonar con el zoom', async () => {
    await mountViewer();
    const fit = wrapper.get('button[aria-pressed]');
    expect(fit.attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[aria-label="Zoom actual"]').text()).toBe('100 %');
    await fit.trigger('click');
    expect(fit.attributes('aria-pressed')).toBe('true');
    await button('Acercar').trigger('click');
    expect(fit.attributes('aria-pressed')).toBe('false');
  });

  it('el lienzo anuncia la página actual', async () => {
    await mountViewer();
    expect(wrapper.get('canvas').attributes('aria-label')).toBe(
      'Página 1 de 3',
    );
  });

  it('solicita el documento por el protocolo', async () => {
    await mountViewer(fakeHandle(), 'wc\\mi doc.pdf');
    expect(loader.openPdf).toHaveBeenCalledWith(
      'http://workspace-file.localhost/wc/mi%20doc.pdf',
    );
  });
});
