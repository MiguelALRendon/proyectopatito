import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

vi.mock('../../services/filesApi', () => ({
  fsCanOpenExternal: vi.fn(async () => false),
  fsProbe: vi.fn(),
  fsReadChunk: vi.fn(),
  fsReadText: vi.fn(),
}));

import { clearProviders, registerProvider } from '../../documents/registry';
import { MAX_EDITABLE_BYTES, isTooLarge } from '../../documents/limits';
import { fsProbe, type FileProbe } from '../../services/filesApi';
import DocumentHost from './DocumentHost.vue';

const TextStub = defineComponent({
  props: ['path', 'probe'],
  emits: ['reprobe'],
  template:
    '<div id="text-stub" @click="$emit(\'reprobe\')">{{ path }}:{{ probe.kind }}</div>',
});
const PATH = 'a\\nota.txt';
const TAB_ID = 'tab-1';

let wrapper: VueWrapper;

function probe(extra: Partial<FileProbe> = {}): FileProbe {
  return {
    kind: 'text',
    mime: 'text/plain',
    len: 10,
    extension: null,
    has_macros: false,
    version: null,
    ...extra,
  };
}

async function mountHost(path = PATH) {
  wrapper = mount(DocumentHost, { props: { path, tabId: TAB_ID } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.mocked(fsProbe).mockReset();
  clearProviders();
  registerProvider({
    id: 'text',
    label: 'Texto',
    matches: ({ probe: found }) => (found.kind === 'text' ? 10 : 0),
    component: TextStub,
  });
});

afterEach(() => {
  wrapper.unmount();
  clearProviders();
});

describe('DocumentHost: adversarial', () => {
  it('con error de sondeo muestra la tarjeta con el mensaje y «Reintentar» lo recupera', async () => {
    vi.mocked(fsProbe)
      .mockRejectedValueOnce({
        kind: 'forbidden_path',
        message: 'ruta prohibida',
        codes: [],
        detail: null,
      })
      .mockResolvedValueOnce(probe());
    await mountHost();
    expect(wrapper.get('[role="status"]').text()).toContain('ruta prohibida');
    expect(wrapper.find('#text-stub').exists()).toBe(false);

    const retry = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Reintentar');
    await retry?.trigger('click');
    await flushPromises();
    expect(wrapper.find('#text-stub').exists()).toBe(true);
  });

  it('sin ningún proveedor que responda cae a BinaryCard', async () => {
    clearProviders();
    vi.mocked(fsProbe).mockResolvedValue(probe());
    await mountHost();
    expect(wrapper.find('article').exists()).toBe(true);
    expect(wrapper.text()).toContain('Mostrar hexadecimal');
  });

  it('un texto por encima del tope cae a BinaryCard con el aviso del límite', async () => {
    registerProvider({
      id: 'text',
      label: 'Texto',
      matches: ({ probe: found }) =>
        !isTooLarge(found) && found.kind === 'text' ? 10 : 0,
      component: TextStub,
    });
    vi.mocked(fsProbe).mockResolvedValue(
      probe({ len: MAX_EDITABLE_BYTES + 1 }),
    );
    await mountHost();
    expect(wrapper.find('#text-stub').exists()).toBe(false);
    expect(wrapper.text()).toContain('Supera el tamaño máximo');
  });

  it('un archivo en la nube muestra su tarjeta sin consultar proveedores', async () => {
    vi.mocked(fsProbe).mockResolvedValue(probe({ kind: 'cloud', len: 4096 }));
    await mountHost();
    expect(wrapper.text()).toContain('solo en la nube');
    expect(wrapper.text()).toContain('Descargar y abrir');
    expect(wrapper.find('#text-stub').exists()).toBe(false);
    expect(fsProbe).toHaveBeenCalledTimes(1);
    expect(fsProbe).toHaveBeenCalledWith(PATH, false);
  });

  it('un fallo al descargar conserva la tarjeta y muestra el error', async () => {
    vi.mocked(fsProbe).mockResolvedValueOnce(probe({ kind: 'cloud' }));
    await mountHost();
    vi.mocked(fsProbe).mockRejectedValueOnce({
      kind: 'io',
      message: 'cancelado',
      codes: [],
      detail: null,
    });
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('cancelado');
    expect(wrapper.text()).toContain('Descargar y abrir');
  });

  it('si el archivo sigue en la nube tras descargar mantiene la tarjeta', async () => {
    vi.mocked(fsProbe).mockResolvedValue(probe({ kind: 'cloud' }));
    await mountHost();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('solo en la nube');
    expect(fsProbe).toHaveBeenLastCalledWith(PATH, true);
  });

  it('una respuesta atrasada de un sondeo anterior no pisa la del nuevo', async () => {
    let resolveOld: (value: FileProbe) => void = () => undefined;
    vi.mocked(fsProbe)
      .mockReturnValueOnce(
        new Promise<FileProbe>((done) => (resolveOld = done)),
      )
      .mockResolvedValueOnce(probe({ kind: 'binary' }));
    wrapper = mount(DocumentHost, {
      props: { path: 'a\\viejo.txt', tabId: TAB_ID },
    });
    await wrapper.setProps({ path: 'a\\nuevo.bin' });
    await flushPromises();
    resolveOld(probe({ kind: 'text' }));
    await flushPromises();
    expect(wrapper.find('#text-stub').exists()).toBe(false);
    expect(wrapper.text()).toContain('nuevo.bin');
  });
});

describe('DocumentHost: flujo normal', () => {
  it('muestra el estado de apertura mientras sondea', async () => {
    vi.mocked(fsProbe).mockReturnValue(new Promise(() => undefined));
    wrapper = mount(DocumentHost, { props: { path: PATH, tabId: TAB_ID } });
    expect(wrapper.get('[role="status"]').text()).toContain('Abriendo');
  });

  it('monta el proveedor elegido con la ruta y el sondeo', async () => {
    vi.mocked(fsProbe).mockResolvedValue(probe());
    await mountHost();
    expect(wrapper.get('#text-stub').text()).toBe(`${PATH}:text`);
  });

  it('«Descargar y abrir» repite el sondeo con descarga y abre el proveedor', async () => {
    vi.mocked(fsProbe).mockResolvedValueOnce(probe({ kind: 'cloud' }));
    await mountHost();
    vi.mocked(fsProbe).mockResolvedValueOnce(probe());
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(fsProbe).toHaveBeenLastCalledWith(PATH, true);
    expect(wrapper.find('#text-stub').exists()).toBe(true);
  });

  it('el evento reprobe del proveedor repite el sondeo sin descarga', async () => {
    vi.mocked(fsProbe).mockResolvedValue(probe());
    await mountHost();
    vi.mocked(fsProbe).mockResolvedValueOnce(probe({ kind: 'cloud' }));
    await wrapper.get('#text-stub').trigger('click');
    await flushPromises();
    expect(fsProbe).toHaveBeenLastCalledWith(PATH, false);
    expect(wrapper.text()).toContain('solo en la nube');
  });
});
