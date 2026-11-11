import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

vi.mock('../../services/filesApi', () => ({ fsReadChunk: vi.fn() }));

import { fsReadChunk } from '../../services/filesApi';
import { ROW_HEIGHT_PX } from '../../documents/hex';
import { HEX_CHUNK } from '../../documents/limits';
import HexViewer from './HexViewer.vue';

const GIB = 1024 * 1024 * 1024;
const DEFAULT_VISIBLE_ROWS = 400 / ROW_HEIGHT_PX;

let wrapper: VueWrapper;

function mountViewer(length: number) {
  wrapper = mount(HexViewer, {
    props: { path: 'a\\datos.bin', length },
    attachTo: document.body,
  });
  return wrapper;
}

const rows = () => wrapper.findAll('.hex-viewer__row');

async function scrollTo(position: number) {
  const scroller = wrapper.get('[role="table"]').element as HTMLElement;
  scroller.scrollTop = position;
  await wrapper.get('[role="table"]').trigger('scroll');
  await flushPromises();
}

beforeEach(() => {
  vi.mocked(fsReadChunk).mockReset();
  vi.mocked(fsReadChunk).mockImplementation(async (_path, offset) => {
    const bytes = new Uint8Array(HEX_CHUNK);
    bytes.forEach((_, i) => (bytes[i] = (offset + i) % 256));
    return bytes.buffer;
  });
});

afterEach(() => wrapper.unmount());

describe('HexViewer: adversarial', () => {
  it('un archivo vacío muestra un aviso y no lee nada', async () => {
    mountViewer(0);
    await flushPromises();
    expect(wrapper.text()).toContain('El archivo está vacío.');
    expect(wrapper.find('[role="table"]').exists()).toBe(false);
    expect(fsReadChunk).not.toHaveBeenCalled();
  });

  it('la cabecera de columnas es visible para la tecnología de apoyo y pertenece a la tabla', async () => {
    mountViewer(GIB);
    await flushPromises();
    const head = wrapper.get('.hex-viewer__head');
    expect(head.attributes('aria-hidden')).toBeUndefined();
    expect(head.attributes('role')).toBe('row');
    const titles = head.findAll('[role="columnheader"]');
    expect(titles.map((title) => title.text()).filter(Boolean)).toContain(
      'Posición',
    );
    expect(titles).toHaveLength(3);
    expect(wrapper.get('[role="table"]').attributes('aria-owns')).toBe(
      head.attributes('id'),
    );
  });

  it('un archivo de GiB dibuja solo unas pocas filas y pide un único tramo', async () => {
    mountViewer(GIB);
    await flushPromises();
    expect(rows().length).toBeLessThan(DEFAULT_VISIBLE_ROWS * 2);
    expect(fsReadChunk).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[role="table"]').attributes('aria-rowcount')).toBe(
      String(GIB / 16),
    );
  });

  it('desplazarse al final de un archivo enorme lee el último tramo y no los intermedios', async () => {
    mountViewer(GIB);
    await flushPromises();
    await scrollTo(1e12);
    const offsets = vi.mocked(fsReadChunk).mock.calls.map((call) => call[1]);
    expect(offsets).toContain(GIB - HEX_CHUNK);
    expect(offsets.length).toBeLessThanOrEqual(3);
    const lastOffset = rows().pop()?.find('.hex-viewer__offset').text();
    expect(lastOffset).toBe(
      (GIB - 16).toString(16).toUpperCase().padStart(8, '0'),
    );
  });

  it('un fallo de lectura muestra el error y «Reintentar» lo recupera', async () => {
    vi.mocked(fsReadChunk).mockRejectedValueOnce({
      kind: 'io',
      message: 'sin acceso',
      codes: [],
      detail: null,
    });
    mountViewer(100);
    await flushPromises();
    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain('No se pudo leer el archivo: sin acceso');

    await alert.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(rows()[0].text()).toContain('00');
  });

  it('mientras llega el tramo muestra marcadores y no lanza', async () => {
    vi.mocked(fsReadChunk).mockReturnValue(new Promise(() => undefined));
    mountViewer(32);
    await flushPromises();
    expect(rows()[0].text()).toContain('··');
  });
});

describe('HexViewer: contenido', () => {
  it('muestra el desplazamiento, los 16 bytes y el texto de cada fila', async () => {
    mountViewer(48);
    await flushPromises();
    expect(rows()).toHaveLength(3);
    const first = rows()[0];
    expect(first.find('[role="rowheader"]').text()).toBe('00000000');
    expect(first.findAll('.hex-viewer__bytes span')).toHaveLength(16);
    expect(first.find('.hex-viewer__ascii').text()).toHaveLength(16);
    expect(rows()[1].attributes('aria-rowindex')).toBe('2');
  });

  it('la última fila parcial tiene solo los bytes restantes', async () => {
    mountViewer(20);
    await flushPromises();
    expect(rows()[1].findAll('.hex-viewer__bytes span')).toHaveLength(4);
  });

  it('es una tabla accesible y enfocable con teclado, de solo lectura', async () => {
    mountViewer(32);
    const table = wrapper.get('[role="table"]');
    expect(table.attributes('tabindex')).toBe('0');
    expect(table.attributes('aria-label')).toContain('solo lectura');
    expect(wrapper.find('input, textarea, [contenteditable]').exists()).toBe(
      false,
    );
  });
});
