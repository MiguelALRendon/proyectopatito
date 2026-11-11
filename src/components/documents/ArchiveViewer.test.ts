import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type {
  ArchiveEntry,
  ArchiveListing,
  ExtractReport,
} from '../../services/archiveApi';
import type { FileProbe } from '../../services/filesApi';
import type { CommandError } from '../../services/tauri';

const api = vi.hoisted(() => ({
  archiveCancel: vi.fn(),
  archiveExtract: vi.fn(),
  archiveList: vi.fn(),
  newArchiveTaskId: vi.fn(),
  onArchiveProgress: vi.fn(),
}));
vi.mock('../../services/archiveApi', () => api);

const store = vi.hoisted(() => ({
  open: vi.fn(),
  reloadAfterChange: vi.fn(),
}));
vi.mock('../../stores/tabs', () => ({
  useTabsStore: () => ({ open: store.open }),
}));
vi.mock('../../stores/explorer', () => ({
  useExplorerStore: () => ({ reloadAfterChange: store.reloadAfterChange }),
}));

import ArchiveViewer from './ArchiveViewer.vue';
import OpenExternalButton from './OpenExternalButton.vue';

const PROBE: FileProbe = {
  kind: 'archive',
  mime: 'application/zip',
  len: 1000,
  extension: 'zip',
  has_macros: false,
  version: null,
};

const REPORT: ExtractReport = {
  destination: 'C:\\wc\\datos',
  files: 2,
  directories: 1,
  bytes: 2048,
  skipped: [{ name: '../mala', reason: 'sube de carpeta con «..»' }],
  skipped_more: 0,
};

function entry(name: string, extra: Partial<ArchiveEntry> = {}): ArchiveEntry {
  return {
    name,
    kind: 'file',
    size: 10,
    packed: 5,
    encrypted: false,
    skip_reason: null,
    ...extra,
  };
}

function listing(extra: Partial<ArchiveListing> = {}): ArchiveListing {
  return {
    format: 'zip',
    entries: [entry('a.txt'), entry('dir/', { kind: 'directory', size: 0 })],
    entry_count: 2,
    truncated: false,
    declared_bytes: 10,
    largest_entry_bytes: 10,
    encrypted: false,
    suspicions: [],
    ...extra,
  };
}

function failure(
  kind: CommandError['kind'],
  message: string = kind,
): CommandError {
  return { kind, message, codes: [], detail: null };
}

let wrapper: VueWrapper;

async function mountViewer(path = 'C:\\wc\\datos.zip') {
  wrapper = mount(ArchiveViewer, {
    props: { path, probe: PROBE },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const dialog = () => document.body.querySelector('[role="dialog"]');
const dialogButton = (label: string) =>
  [...(dialog()?.querySelectorAll('button') ?? [])].find((item) =>
    item.textContent?.includes(label),
  ) as HTMLButtonElement;
const extractButton = () =>
  wrapper
    .findAll('button')
    .find((item) => item.text().includes('Extraer todo'));

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(api).forEach((mock) => mock.mockReset());
  Object.values(store).forEach((mock) => mock.mockReset());
  let next = 0;
  api.newArchiveTaskId.mockImplementation(() => (next += 1));
  api.archiveCancel.mockResolvedValue(true);
  api.onArchiveProgress.mockResolvedValue(() => undefined);
  api.archiveList.mockResolvedValue(listing());
});

afterEach(() => wrapper.unmount());

describe('ArchiveViewer: listado', () => {
  it('pide el listado con un id de tarea y muestra las entradas', async () => {
    await mountViewer();
    expect(api.archiveList).toHaveBeenCalledWith('C:\\wc\\datos.zip', 1);
    const rows = wrapper.findAll('[role="row"]');
    expect(rows).toHaveLength(3);
    expect(rows[1].text()).toContain('a.txt');
    expect(wrapper.get('[role="table"]').attributes('aria-rowcount')).toBe('3');
    expect(wrapper.text()).toContain('ZIP · 2 entradas');
  });

  it('el nombre malicioso se pinta como texto y los controles quedan visibles', async () => {
    api.archiveList.mockResolvedValue(
      listing({
        entries: [
          entry('<img src=x onerror=alert(1)>.txt'),
          entry(`foto${String.fromCharCode(0x202e)}gpj.exe`),
        ],
      }),
    );
    await mountViewer();
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>.txt');
    expect(wrapper.text()).toContain('foto‹U+202E›gpj.exe');
    expect(wrapper.text()).toContain('Nombre con caracteres ocultos');
  });

  it('marca lo que no se extraerá con su razón y lo cifrado', async () => {
    api.archiveList.mockResolvedValue(
      listing({
        entries: [
          entry('ln', { kind: 'link', skip_reason: 'enlace: no se extraen' }),
          entry('sec.bin', { encrypted: true }),
        ],
      }),
    );
    await mountViewer();
    expect(wrapper.text()).toContain('No se extrae: enlace: no se extraen');
    expect(wrapper.text()).toContain('Cifrada');
  });

  it('conserva la apertura externa del archivo en la barra de acciones', async () => {
    await mountViewer();
    expect(wrapper.findComponent(OpenExternalButton).props('path')).toBe(
      'C:\\wc\\datos.zip',
    );
  });

  it('un archivo cifrado se puede ver pero no extraer', async () => {
    api.archiveList.mockResolvedValue(listing({ encrypted: true }));
    await mountViewer();
    expect(wrapper.text()).toContain('entradas cifradas');
    expect(extractButton()?.attributes('disabled')).toBeDefined();
  });

  it('muestra un guion en el tamaño de los directorios y de los valores nulos', async () => {
    api.archiveList.mockResolvedValue(
      listing({
        entries: [
          entry('carpeta/', { kind: 'directory', size: 99, packed: 99 }),
          entry('sin-dato.bin', { size: 7, packed: null }),
        ],
      }),
    );
    await mountViewer();
    const rows = wrapper.findAll('[role="row"]').slice(1);
    const cells = rows.map((row) =>
      row.findAll('[role="cell"]').map((cell) => cell.text()),
    );
    expect(cells[0].slice(1, 3)).toEqual(['-', '-']);
    expect(cells[1][1]).not.toBe('-');
    expect(cells[1][2]).toBe('-');
  });

  it('avisa cuando el listado está truncado', async () => {
    api.archiveList.mockResolvedValue(
      listing({ truncated: true, entry_count: 60000 }),
    );
    await mountViewer();
    expect(wrapper.text()).toContain('Hay más entradas de las que se muestran');
    expect(wrapper.text()).toContain('60000 entradas');
  });

  it('un archivo dañado cae a la tarjeta binaria con el mensaje de Rust', async () => {
    api.archiveList.mockRejectedValue(
      failure('archive_corrupt', 'el archivo está dañado'),
    );
    await mountViewer();
    expect(wrapper.get('article').text()).toContain('el archivo está dañado');
    expect(wrapper.text()).toContain('Mostrar hexadecimal');
    expect(extractButton()).toBeUndefined();
  });

  it('tras un fallo, abrir otro archivo vuelve a cargar y muestra su listado', async () => {
    api.archiveList.mockRejectedValueOnce(
      failure('archive_corrupt', 'el archivo está dañado'),
    );
    await mountViewer();
    expect(wrapper.get('article').text()).toContain('el archivo está dañado');
    api.archiveList.mockResolvedValueOnce(
      listing({ entries: [entry('otro.txt')] }),
    );
    await wrapper.setProps({ path: 'C:\wc\otro.zip' });
    await flushPromises();
    expect(api.archiveList).toHaveBeenLastCalledWith('C:\wc\otro.zip', 2);
    expect(wrapper.text()).toContain('otro.txt');
  });

  it('al cambiar de ruta cancela el listado anterior y descarta su respuesta tardía', async () => {
    let late!: (value: ArchiveListing) => void;
    api.archiveList.mockReturnValueOnce(
      new Promise<ArchiveListing>((resolve) => (late = resolve)),
    );
    wrapper = mount(ArchiveViewer, {
      props: { path: 'C:\\wc\\uno.zip', probe: PROBE },
      attachTo: document.body,
    });
    await flushPromises();
    api.archiveList.mockResolvedValueOnce(
      listing({ entries: [entry('nuevo.txt')] }),
    );
    await wrapper.setProps({ path: 'C:\\wc\\dos.zip' });
    await flushPromises();
    expect(api.archiveCancel).toHaveBeenCalledWith(1);
    late(listing({ entries: [entry('viejo.txt')] }));
    await flushPromises();
    expect(wrapper.text()).toContain('nuevo.txt');
    expect(wrapper.text()).not.toContain('viejo.txt');
  });

  it('al desmontar durante el listado lo cancela', async () => {
    api.archiveList.mockReturnValue(new Promise(() => undefined));
    wrapper = mount(ArchiveViewer, {
      props: { path: 'C:\\wc\\a.zip', probe: PROBE },
    });
    await flushPromises();
    wrapper.unmount();
    expect(api.archiveCancel).toHaveBeenCalledWith(1);
    wrapper = mount(ArchiveViewer, {
      props: { path: 'C:\\wc\\b.zip', probe: PROBE },
    });
  });
});

describe('ArchiveViewer: extracción', () => {
  async function openDialog() {
    await mountViewer();
    await extractButton()?.trigger('click');
    await flushPromises();
  }

  it('no extrae hasta que el usuario lo pide y no lleva nombre de destino', async () => {
    await openDialog();
    expect(dialog()?.textContent).toContain('carpeta nueva junto al archivo');
    expect(api.archiveExtract).not.toHaveBeenCalled();
  });

  it('extrae, muestra lo omitido, avisa a los demás explorers y abre la carpeta', async () => {
    api.archiveExtract.mockResolvedValue(REPORT);
    await openDialog();
    dialogButton('Extraer').click();
    await flushPromises();
    expect(api.archiveExtract).toHaveBeenCalledWith(
      'C:\\wc\\datos.zip',
      2,
      false,
    );
    expect(dialog()?.textContent).toContain('2 archivos y 1 carpeta');
    expect(dialog()?.textContent).toContain('../mala');
    expect(store.reloadAfterChange).toHaveBeenCalledTimes(1);
    dialogButton('Abrir carpeta').click();
    await flushPromises();
    expect(store.open).toHaveBeenCalledWith('C:\\wc\\datos');
    expect(dialog()).toBeNull();
  });

  it('cerrar el resultado no abre ninguna carpeta', async () => {
    api.archiveExtract.mockResolvedValue(REPORT);
    await openDialog();
    dialogButton('Extraer').click();
    await flushPromises();
    dialogButton('Cerrar').click();
    await flushPromises();
    expect(store.open).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('un archivo sospechoso exige el botón explícito y envía la confirmación', async () => {
    api.archiveList.mockResolvedValue(listing({ suspicions: ['ratio'] }));
    api.archiveExtract.mockResolvedValue(REPORT);
    await openDialog();
    expect(dialog()?.textContent).toContain('sospechoso');
    expect(dialog()?.textContent).toContain('200 veces');
    expect(dialogButton('Extraer de todos modos')).toBeDefined();
    dialogButton('Extraer de todos modos').click();
    await flushPromises();
    expect(api.archiveExtract).toHaveBeenCalledWith(
      'C:\\wc\\datos.zip',
      2,
      true,
    );
  });

  it('el aviso de OneDrive solo sale dentro de OneDrive', async () => {
    await mountViewer('C:\\Users\\ana\\OneDrive\\datos.zip');
    await extractButton()?.trigger('click');
    await flushPromises();
    expect(dialog()?.textContent).toContain('OneDrive');
    wrapper.unmount();
    await mountViewer('C:\\wc\\datos.zip');
    await extractButton()?.trigger('click');
    await flushPromises();
    expect(dialog()?.textContent).not.toContain('OneDrive');
  });

  it('un fallo al extraer se muestra y se puede reintentar', async () => {
    api.archiveExtract.mockRejectedValueOnce(
      failure('archive_limit', 'supera el tope de 4 GiB'),
    );
    await openDialog();
    dialogButton('Extraer').click();
    await flushPromises();
    expect(dialog()?.textContent).toContain('supera el tope de 4 GiB');
    api.archiveExtract.mockResolvedValueOnce(REPORT);
    dialogButton('Reintentar').click();
    await flushPromises();
    expect(dialog()?.textContent).toContain('2 archivos');
  });

  it('tras un fallo, Cerrar descarta el diálogo sin reintentar', async () => {
    api.archiveExtract.mockRejectedValueOnce(
      failure('archive_limit', 'supera el tope de 4 GiB'),
    );
    await openDialog();
    dialogButton('Extraer').click();
    await flushPromises();
    dialogButton('Cerrar').click();
    await flushPromises();
    expect(dialog()).toBeNull();
    expect(api.archiveExtract).toHaveBeenCalledTimes(1);
  });

  it('cancelar a mitad lo dice y no deja el diálogo atascado', async () => {
    let reject!: (error: CommandError) => void;
    api.archiveExtract.mockReturnValue(
      new Promise((_, fail) => (reject = fail)),
    );
    await openDialog();
    dialogButton('Extraer').click();
    await flushPromises();
    expect(dialogButton('Cancelar extracción')).toBeDefined();
    dialogButton('Cancelar extracción').click();
    expect(api.archiveCancel).toHaveBeenCalledWith(2);
    reject(failure('cancelled'));
    await flushPromises();
    expect(dialog()?.textContent).toContain('No quedó nada en el disco');
    expect(store.reloadAfterChange).not.toHaveBeenCalled();
  });

  it('indica cuántas entradas omitidas quedaron fuera de la lista', async () => {
    api.archiveExtract.mockResolvedValue({ ...REPORT, skipped_more: 3 });
    await openDialog();
    dialogButton('Extraer').click();
    await flushPromises();
    expect(dialog()?.textContent).toContain('y 3 más');
  });

  it('mientras extrae, el clic en el fondo no cierra el diálogo', async () => {
    api.archiveExtract.mockReturnValue(new Promise(() => undefined));
    await openDialog();
    dialogButton('Extraer').click();
    await flushPromises();
    const overlay = document.body.querySelector('.base-modal__overlay');
    overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(dialog()).not.toBeNull();
  });

  it('mientras extrae, Escape no cierra el diálogo', async () => {
    api.archiveExtract.mockReturnValue(new Promise(() => undefined));
    await openDialog();
    dialogButton('Extraer').click();
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(dialog()).not.toBeNull();
  });
});
