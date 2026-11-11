import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

vi.mock('../../services/filesApi', () => ({
  fsCanOpenExternal: vi.fn(async () => false),
  fsOpenExternal: vi.fn(),
  fsReadChunk: vi.fn(async () => new Uint8Array(16).buffer),
}));

import { MAX_EDITABLE_BYTES } from '../../documents/limits';
import {
  fsCanOpenExternal,
  fsReadChunk,
  type FileProbe,
} from '../../services/filesApi';
import BinaryCard from './BinaryCard.vue';

let wrapper: VueWrapper;

function probe(extra: Partial<FileProbe> = {}): FileProbe {
  return {
    kind: 'binary',
    mime: 'application/octet-stream',
    len: 2048,
    extension: null,
    has_macros: false,
    version: null,
    ...extra,
  };
}

function mountCard(
  path: string,
  found: FileProbe | null,
  notice?: string,
  slots: Record<string, string> = {},
) {
  wrapper = mount(BinaryCard, {
    props: { path, probe: found, notice },
    slots,
    attachTo: document.body,
  });
  return wrapper;
}

const hexButton = () =>
  wrapper.findAll('button').find((item) => item.text().includes('hexadecimal'));

const openButton = () =>
  wrapper
    .findAll('button')
    .find((item) => item.text().includes('aplicación predeterminada'));

afterEach(() => wrapper.unmount());

describe('BinaryCard: adversarial', () => {
  it('sin sondeo no muestra datos ni el botón de hexadecimal pero sí el aviso', () => {
    mountCard('a\\roto.bin', null, 'No se pudo abrir el archivo: sin acceso');
    expect(wrapper.find('dl').exists()).toBe(false);
    expect(hexButton()).toBeUndefined();
    expect(wrapper.get('[role="status"]').text()).toContain('sin acceso');
  });

  it('un .md binario explica que nunca se interpreta como texto', () => {
    mountCard('a\\falso.md', probe());
    expect(wrapper.get('[role="status"]').text()).toContain(
      'nunca se interpreta como texto',
    );
    expect(wrapper.text()).toContain('Archivo binario (.md)');
  });

  it('un texto por encima del tope avisa del límite del editor', () => {
    mountCard(
      'a\\grande.txt',
      probe({ kind: 'text', len: MAX_EDITABLE_BYTES + 1 }),
    );
    expect(wrapper.get('[role="status"]').text()).toContain(
      'Supera el tamaño máximo del editor (5 MiB)',
    );
  });

  it('un texto dentro del tope no muestra aviso', () => {
    mountCard('a\\ok.txt', probe({ kind: 'text', len: MAX_EDITABLE_BYTES }));
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it('sin sondeo no pregunta ni ofrece abrir con la aplicación predeterminada', async () => {
    vi.mocked(fsCanOpenExternal).mockClear();
    mountCard(
      'a\\informe.docx',
      null,
      'No se pudo abrir el archivo: sin acceso',
    );
    await flushPromises();
    expect(fsCanOpenExternal).not.toHaveBeenCalled();
    expect(openButton()).toBeUndefined();
  });

  it('un binario sin nombre de texto no muestra aviso', () => {
    mountCard('a\\datos.bin', probe());
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it('el aviso explícito tiene prioridad sobre el calculado', () => {
    mountCard('a\\falso.md', probe(), 'Aviso propio');
    expect(wrapper.get('[role="status"]').text()).toBe('Aviso propio');
  });

  it('un archivo de 0 bytes ofrece hexadecimal y dice que está vacío', async () => {
    mountCard('a\\vacio.bin', probe({ len: 0 }));
    await hexButton()?.trigger('click');
    expect(wrapper.text()).toContain('El archivo está vacío.');
  });
});

describe('BinaryCard: contenido', () => {
  it('muestra tipo, tamaño exacto y MIME', () => {
    mountCard('carpeta\\datos.bin', probe());
    expect(wrapper.text()).toContain('datos.bin');
    expect(wrapper.text()).toContain('Archivo binario (.bin)');
    expect(wrapper.text()).toContain('2 KB (2048 bytes)');
    expect(wrapper.text()).toContain('application/octet-stream');
  });

  it('muestra el tipo de una imagen y un PDF', () => {
    mountCard('a.png', probe({ kind: 'image', mime: 'image/png' }));
    expect(wrapper.text()).toContain('Imagen (.png)');
    wrapper.unmount();
    mountCard('a.pdf', probe({ kind: 'pdf', mime: 'application/pdf' }));
    expect(wrapper.text()).toContain('Documento PDF (.pdf)');
  });

  it.each([
    ['office', 'a.docx', 'Documento de Office (.docx)'],
    ['audio', 'a.mp3', 'Audio (.mp3)'],
    ['video', 'a.mp4', 'Vídeo (.mp4)'],
    ['archive', 'a.zip', 'Archivo comprimido (.zip)'],
  ] as const)(
    'etiqueta el tipo %s mientras no exista su visor',
    (kind, name, label) => {
      mountCard(name, probe({ kind }));
      expect(wrapper.text()).toContain(label);
    },
  );

  it('alterna el visor hexadecimal con aria-expanded', async () => {
    mountCard('a\\datos.bin', probe());
    expect(wrapper.find('[role="table"]').exists()).toBe(false);
    expect(hexButton()?.attributes('aria-expanded')).toBe('false');

    await hexButton()?.trigger('click');
    expect(wrapper.find('[role="table"]').exists()).toBe(true);
    expect(hexButton()?.text()).toBe('Ocultar hexadecimal');
    expect(hexButton()?.attributes('aria-expanded')).toBe('true');

    await hexButton()?.trigger('click');
    expect(wrapper.find('[role="table"]').exists()).toBe(false);
  });

  it('aria-controls solo existe mientras el panel hexadecimal está visible', async () => {
    mountCard('a\\datos.bin', probe());
    expect(hexButton()?.attributes('aria-controls')).toBeUndefined();

    await hexButton()?.trigger('click');
    const panelId = hexButton()?.attributes('aria-controls');
    expect(panelId).toBeDefined();
    expect(wrapper.find(`#${panelId}`).exists()).toBe(true);
  });

  it('al cambiar de archivo el visor hexadecimal se recrea y lee el nuevo', async () => {
    mountCard('a\\uno.bin', probe());
    await hexButton()?.trigger('click');
    await wrapper.setProps({ path: 'a\\dos.bin' });
    await flushPromises();
    const paths = vi.mocked(fsReadChunk).mock.calls.map((call) => call[0]);
    expect(paths).toContain('a\\dos.bin');
  });

  it('ofrece abrir con la aplicación predeterminada solo si el backend lo permite', async () => {
    vi.mocked(fsCanOpenExternal).mockResolvedValueOnce(true);
    mountCard('a\\informe.docx', probe());
    await flushPromises();
    expect(openButton()).toBeDefined();
    wrapper.unmount();
    mountCard('a\\script.js', probe());
    await flushPromises();
    expect(openButton()).toBeUndefined();
  });

  it('deja un hueco de composición para acciones adicionales', () => {
    mountCard('a\\datos.bin', probe(), undefined, {
      actions: '<button>Abrir fuera</button>',
    });
    expect(wrapper.text()).toContain('Abrir fuera');
  });
});
