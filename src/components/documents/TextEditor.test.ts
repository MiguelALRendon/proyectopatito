import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const viewer = vi.hoisted(() => ({
  languageLabel: 'JavaScript',
  getContent: vi.fn(),
  setContent: vi.fn(),
  setReadOnly: vi.fn(),
  setTheme: vi.fn(),
  onCursorChange: vi.fn(),
  onContentChange: vi.fn(),
  dispose: vi.fn(),
}));
const openViewer = vi.hoisted(() => vi.fn());
const refreshStatus = vi.hoisted(() => vi.fn());

vi.mock('../../documents/monaco/setup', () => ({ openViewer }));
vi.mock('../../services/filesApi', () => ({
  fsCanOpenExternal: vi.fn(async () => false),
  fsReadText: vi.fn(),
  fsWriteText: vi.fn(),
  fsReadChunk: vi.fn(),
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
}));
vi.mock('../../documents/dialogs', () => ({
  askConflict: vi.fn(),
  askLineEnding: vi.fn(),
  askWindowClose: vi.fn(),
}));
vi.mock('../../composables/useConfirm', () => ({ confirm: vi.fn() }));
vi.mock('../../stores/explorer', () => ({
  useExplorerStore: () => ({ refreshStatus }),
}));

import { confirm } from '../../composables/useConfirm';
import { SCROLL_LOCK_CLASS } from '../../composables/useModalIsolation';
import { useTheme } from '../../composables/useTheme';
import { askConflict, askLineEnding } from '../../documents/dialogs';
import { DOCUMENT_TAB_KEY } from '../../documents/tabContext';
import {
  fsReadText,
  fsWriteText,
  type FileProbe,
  type TextDocument,
} from '../../services/filesApi';
import type { CommandError, ErrorKind } from '../../services/tauri';
import { useDocumentsStore } from '../../stores/documents';
import { useTabsStore } from '../../stores/tabs';
import TextEditor from './TextEditor.vue';

const SETUP_MODULE = '../../documents/monaco/setup';
const PATH = 'wc\\ejemplo.js';
const ORIGINAL = 'const a = 1;\n';
const EDITED = 'const a = 2;\n';
const PROBE: FileProbe = {
  kind: 'text',
  mime: 'text/plain',
  len: 40,
  extension: null,
  has_macros: false,
  version: null,
};

let wrapper: VueWrapper;
let tabId = '';
let editorText = '';

function sample(extra: Partial<TextDocument> = {}): TextDocument {
  return {
    content: ORIGINAL,
    encoding: 'utf8',
    has_bom: false,
    eol: 'lf',
    eol_mixed: false,
    version: 'v1',
    len: 13,
    ...extra,
  };
}

function failure(kind: ErrorKind, message = 'fallo'): CommandError {
  return { kind, message, codes: [], detail: null };
}

function newPage() {
  setActivePinia(createPinia());
  tabId = useTabsStore().open(PATH, 'document') as string;
}

function mountEditor() {
  wrapper = mount(TextEditor, {
    props: { path: PATH, probe: PROBE },
    attachTo: document.body,
    global: { provide: { [DOCUMENT_TAB_KEY as symbol]: tabId } },
  });
  return flushPromises();
}

async function openEditor(extra: Partial<TextDocument> = {}) {
  vi.mocked(fsReadText).mockResolvedValueOnce(sample(extra));
  await mountEditor();
}

async function type(text: string) {
  editorText = text;
  const handler = viewer.onContentChange.mock.calls[0][0];
  handler(text);
  await flushPromises();
}

const bar = () => wrapper.get('[aria-label="Estado del documento"]');
const chip = () => wrapper.get('.text-editor__chip');
const saveButton = () => wrapper.get('.text-editor__save');
const alertText = () => wrapper.find('[role="alert"]').text();

async function pressSave() {
  await saveButton().trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.resetAllMocks();
  newPage();
  editorText = '';
  refreshStatus.mockResolvedValue(undefined);
  openViewer.mockImplementation((options: { content: string }) => {
    editorText = options.content;
    return viewer;
  });
  viewer.getContent.mockImplementation(() => editorText);
  viewer.setContent.mockImplementation((text: string) => (editorText = text));
});

afterEach(() => wrapper.unmount());

describe('TextEditor: adversarial', () => {
  it('NotText cae a la tarjeta de binario con el motivo y no crea el editor', async () => {
    vi.mocked(fsReadText).mockRejectedValue(failure('not_text'));
    await mountEditor();
    expect(openViewer).not.toHaveBeenCalled();
    expect(wrapper.find('article').exists()).toBe(true);
    expect(wrapper.text()).toContain('no es texto UTF-8 ni UTF-16');
    expect(wrapper.text()).toContain('Mostrar hexadecimal');
  });

  it('al caer a binario la tarjeta muestra el tipo efectivo y no «Texto»', async () => {
    vi.mocked(fsReadText).mockRejectedValue(failure('not_text'));
    await mountEditor();
    expect(wrapper.text()).toContain('Archivo binario (.js)');
    expect(wrapper.text()).not.toContain('Texto (.js)');
  });

  it('TooLarge ofrece binario con hexadecimal y el aviso del tope', async () => {
    vi.mocked(fsReadText).mockRejectedValue(failure('too_large'));
    await mountEditor();
    expect(openViewer).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Supera el tamaño máximo del editor');
  });

  it('CloudOnly pide al anfitrión repetir el sondeo y no muestra error', async () => {
    vi.mocked(fsReadText).mockRejectedValue(failure('cloud_only'));
    await mountEditor();
    expect(wrapper.emitted('reprobe')).toHaveLength(1);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('un error cualquiera muestra una alerta y «Reintentar» abre el documento', async () => {
    vi.mocked(fsReadText)
      .mockRejectedValueOnce(failure('io', 'disco lleno'))
      .mockResolvedValueOnce(sample());
    await mountEditor();
    expect(alertText()).toContain('disco lleno');

    await wrapper.get('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(openViewer).toHaveBeenCalledTimes(1);
  });

  it('si falla la creación del editor muestra el error y «Reintentar» lo vuelve a crear', async () => {
    vi.mocked(fsReadText).mockResolvedValue(sample());
    openViewer.mockImplementationOnce(() => {
      throw new Error('no se pudo crear');
    });
    await mountEditor();
    expect(alertText()).toContain('no se pudo crear');

    await wrapper.get('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(openViewer).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('al desmontar libera el editor pero la sesión conserva el texto', async () => {
    await openEditor();
    await type(EDITED);
    wrapper.unmount();
    expect(viewer.dispose).toHaveBeenCalledTimes(1);
    expect(useDocumentsStore().sessionOf(tabId)?.current).toBe(EDITED);
    wrapper = mount(TextEditor, {
      props: { path: PATH, probe: PROBE },
      global: { provide: { [DOCUMENT_TAB_KEY as symbol]: tabId } },
    });
  });

  it('si se desmonta antes de que llegue el texto no crea el editor', async () => {
    let finish: (value: TextDocument) => void = () => undefined;
    vi.mocked(fsReadText).mockReturnValue(
      new Promise<TextDocument>((done) => (finish = done)),
    );
    await mountEditor();
    wrapper.unmount();
    finish(sample());
    await flushPromises();
    expect(openViewer).not.toHaveBeenCalled();
    wrapper = mount(TextEditor, {
      props: { path: PATH, probe: PROBE },
      global: { provide: { [DOCUMENT_TAB_KEY as symbol]: tabId } },
    });
  });

  it('el editor se crea una sola vez aunque la carga y el montaje coincidan', async () => {
    await openEditor();
    expect(openViewer).toHaveBeenCalledTimes(1);
  });
});

describe('TextEditor: carga diferida del módulo del editor', () => {
  it('si se desmonta mientras llega el fragmento del editor no crea el editor', async () => {
    let release: () => void = () => undefined;
    const ready = new Promise<void>((done) => (release = done));
    vi.resetModules();
    vi.doMock(SETUP_MODULE, async () => {
      await ready;
      return { openViewer };
    });
    vi.mocked(fsReadText).mockResolvedValue(sample());
    await mountEditor();
    wrapper.unmount();
    release();
    await flushPromises();
    vi.doMock(SETUP_MODULE, () => ({ openViewer }));
    await import(SETUP_MODULE);
    expect(openViewer).not.toHaveBeenCalled();
    expect(viewer.dispose).not.toHaveBeenCalled();
    wrapper = mount(TextEditor, {
      props: { path: PATH, probe: PROBE },
      global: { provide: { [DOCUMENT_TAB_KEY as symbol]: tabId } },
    });
  });
});

describe('TextEditor: guardar sin perder el contenido', () => {
  it('un error de guardado muestra la alerta, conserva «Modificado» y el texto', async () => {
    await openEditor();
    await type(EDITED);
    vi.mocked(fsWriteText).mockRejectedValueOnce(failure('io', 'disco lleno'));

    await pressSave();

    expect(alertText()).toContain('No se pudo guardar: disco lleno');
    expect(chip().text()).toBe('Modificado');
    expect(useDocumentsStore().sessionOf(tabId)?.current).toBe(EDITED);
    expect(saveButton().attributes('disabled')).toBeUndefined();
  });

  it.each([
    ['file_locked', 'en uso por otro programa'],
    ['working_copy_busy', 'ocupada con otra operación de Subversion'],
  ] as const)(
    '%s da un mensaje claro y «Reintentar» guarda',
    async (kind, text) => {
      await openEditor();
      await type(EDITED);
      vi.mocked(fsWriteText).mockRejectedValueOnce(failure(kind));
      await pressSave();
      expect(alertText()).toContain(text);

      vi.mocked(fsWriteText).mockResolvedValueOnce({ version: 'v2' });
      await wrapper.get('[role="alert"] button').trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
      expect(chip().text()).toBe('Guardado');
    },
  );

  it('un guardado en curso deshabilita el botón y lo rotula «Guardando…»', async () => {
    await openEditor();
    await type(EDITED);
    let finish: (value: { version: string }) => void = () => undefined;
    vi.mocked(fsWriteText).mockReturnValue(
      new Promise((done) => (finish = done)),
    );

    void saveButton().trigger('click');
    await flushPromises();
    expect(saveButton().text()).toBe('Guardando…');
    expect(saveButton().attributes('disabled')).toBeDefined();

    finish({ version: 'v2' });
    await flushPromises();
    expect(saveButton().text()).toBe('Guardar');
  });

  it('Ctrl+S sin cambios no escribe', async () => {
    await openEditor();
    await wrapper
      .get('section')
      .trigger('keydown', { key: 's', ctrlKey: true });
    await flushPromises();
    expect(fsWriteText).not.toHaveBeenCalled();
  });

  it('otras teclas no guardan y Ctrl+S evita el comportamiento del navegador', async () => {
    await openEditor();
    await type(EDITED);
    vi.mocked(fsWriteText).mockResolvedValue({ version: 'v2' });
    await wrapper.get('section').trigger('keydown', { key: 's' });
    await wrapper
      .get('section')
      .trigger('keydown', { key: 'a', ctrlKey: true });
    expect(fsWriteText).not.toHaveBeenCalled();

    const event = new KeyboardEvent('keydown', {
      key: 'S',
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    wrapper.get('section').element.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(fsWriteText).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+S guarda aunque el foco esté fuera del editor, pero no con un diálogo abierto ni tras desmontar', async () => {
    await openEditor();
    await type(EDITED);
    vi.mocked(fsWriteText).mockResolvedValue({ version: 'v2' });
    const press = () =>
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          ctrlKey: true,
          bubbles: true,
        }),
      );

    document.body.classList.add(SCROLL_LOCK_CLASS);
    press();
    await flushPromises();
    expect(fsWriteText).not.toHaveBeenCalled();

    document.body.classList.remove(SCROLL_LOCK_CLASS);
    press();
    await flushPromises();
    expect(fsWriteText).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    press();
    await flushPromises();
    expect(fsWriteText).toHaveBeenCalledTimes(1);
    wrapper = mount(TextEditor, {
      props: { path: PATH, probe: PROBE },
      global: { provide: { [DOCUMENT_TAB_KEY as symbol]: tabId } },
    });
  });

  it('el botón Guardar está deshabilitado mientras no hay cambios', async () => {
    await openEditor();
    expect(saveButton().attributes('disabled')).toBeDefined();
    await type(EDITED);
    expect(saveButton().attributes('disabled')).toBeUndefined();
  });
});

describe('TextEditor: solo lectura', () => {
  async function openReadOnly() {
    await openEditor();
    await type(EDITED);
    vi.mocked(fsWriteText).mockRejectedValueOnce(failure('read_only'));
    await pressSave();
  }

  it('ReadOnly pasa el editor a solo lectura con un aviso claro y conserva los cambios', async () => {
    await openReadOnly();
    expect(alertText()).toContain('solo lectura');
    expect(alertText()).toContain('Tus cambios siguen en el editor');
    expect(viewer.setReadOnly).toHaveBeenLastCalledWith(true);
    expect(wrapper.text()).toContain('Solo lectura');
    expect(chip().text()).toBe('Modificado');
  });

  it('«Reintentar guardado» guarda cuando el archivo ya se puede escribir y sale de solo lectura', async () => {
    await openReadOnly();
    vi.mocked(fsWriteText).mockResolvedValueOnce({ version: 'v2' });

    await wrapper.findAll('[role="alert"] button')[0].trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(viewer.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(wrapper.text()).not.toContain('Solo lectura');
  });

  it('«Recargar» con cambios pide confirmación y cancelar no pierde nada', async () => {
    await openReadOnly();
    vi.mocked(confirm).mockResolvedValue(false);

    await wrapper.findAll('[role="alert"] button')[1].trigger('click');
    await flushPromises();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fsReadText).toHaveBeenCalledTimes(1);
    expect(useDocumentsStore().sessionOf(tabId)?.current).toBe(EDITED);
  });

  it('«Recargar» confirmado trae el disco al editor y quita el modo de solo lectura', async () => {
    await openReadOnly();
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(fsReadText).mockResolvedValueOnce(
      sample({ content: 'del disco\n', version: 'v5' }),
    );

    await wrapper.findAll('[role="alert"] button')[1].trigger('click');
    await flushPromises();

    expect(viewer.setContent).toHaveBeenCalledWith('del disco\n');
    expect(viewer.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(chip().text()).toBe('Guardado');
  });
});

describe('TextEditor: final de línea mixto', () => {
  const mixed = {
    content: 'a\r\nb\nc\n',
    eol: 'crlf',
    eol_mixed: true,
  } as const;

  it('pregunta antes de normalizar y cancelar no escribe nada', async () => {
    await openEditor(mixed);
    await type('a\r\nb\nc\nd\n');
    vi.mocked(askLineEnding).mockResolvedValue(null);

    await pressSave();

    expect(askLineEnding).toHaveBeenCalledWith('ejemplo.js', 'crlf');
    expect(fsWriteText).not.toHaveBeenCalled();
    expect(chip().text()).toBe('Modificado');
  });

  it('con el final de línea elegido guarda con él y deja de avisar', async () => {
    await openEditor(mixed);
    await type('a\r\nb\nc\nd\n');
    vi.mocked(askLineEnding).mockResolvedValue('lf');
    vi.mocked(fsWriteText).mockResolvedValue({ version: 'v2' });

    await pressSave();

    expect(vi.mocked(fsWriteText).mock.calls[0][0].eol).toBe('lf');
    expect(bar().text()).not.toContain('Fin de línea mixto');
    expect(bar().text()).toContain('LF');
    await pressSave();
    expect(askLineEnding).toHaveBeenCalledTimes(1);
  });

  it('avisa del fin de línea mixto en la barra de estado', async () => {
    await openEditor({ eol: 'crlf', eol_mixed: true });
    expect(bar().get('[role="status"]').text()).toContain(
      'Fin de línea mixto: predomina CRLF.',
    );
  });
});

describe('TextEditor: conflicto con un cambio externo', () => {
  async function openConflict() {
    await openEditor();
    await type(EDITED);
    vi.mocked(fsWriteText).mockRejectedValueOnce(failure('file_changed'));
  }

  it('Recargar descarta mis cambios y muestra la versión del disco', async () => {
    await openConflict();
    vi.mocked(askConflict).mockResolvedValue('reload');
    vi.mocked(fsReadText).mockResolvedValueOnce(
      sample({ content: 'externo\n', version: 'v8' }),
    );

    await pressSave();

    expect(askConflict).toHaveBeenCalledWith('ejemplo.js');
    expect(viewer.setContent).toHaveBeenCalledWith('externo\n');
    expect(chip().text()).toBe('Guardado');
    expect(useDocumentsStore().sessionOf(tabId)?.hasConflict).toBe(false);
  });

  it('Sobrescribir relee la versión y guarda encima', async () => {
    await openConflict();
    vi.mocked(askConflict).mockResolvedValue('overwrite');
    vi.mocked(fsReadText).mockResolvedValueOnce(
      sample({ content: 'externo\n', version: 'v8' }),
    );
    vi.mocked(fsWriteText).mockResolvedValueOnce({ version: 'v9' });

    await pressSave();

    const writes = vi.mocked(fsWriteText).mock.calls;
    expect(writes).toHaveLength(2);
    expect(writes[1][0].expected_version).toBe('v8');
    expect(writes[1][0].content).toBe(EDITED);
    expect(chip().text()).toBe('Guardado');
  });

  it('Cancelar no toca el disco, conserva el texto y permite volver a intentar', async () => {
    await openConflict();
    vi.mocked(askConflict).mockResolvedValue(null);

    await pressSave();

    expect(fsReadText).toHaveBeenCalledTimes(1);
    expect(fsWriteText).toHaveBeenCalledTimes(1);
    expect(chip().text()).toBe('Modificado');
    expect(useDocumentsStore().sessionOf(tabId)?.hasConflict).toBe(false);

    vi.mocked(fsWriteText).mockRejectedValueOnce(failure('file_changed'));
    await pressSave();
    expect(askConflict).toHaveBeenCalledTimes(2);
  });

  it('si el archivo cambia otra vez durante la sobrescritura vuelve a preguntar', async () => {
    await openConflict();
    vi.mocked(askConflict).mockResolvedValueOnce('overwrite');
    vi.mocked(askConflict).mockResolvedValueOnce(null);
    vi.mocked(fsReadText).mockResolvedValueOnce(sample({ version: 'v8' }));
    vi.mocked(fsWriteText).mockRejectedValueOnce(failure('file_changed'));

    await pressSave();

    expect(askConflict).toHaveBeenCalledTimes(2);
    expect(chip().text()).toBe('Modificado');
  });

  it('un conflicto pendiente al volver a la pestaña vuelve a preguntar', async () => {
    await openConflict();
    vi.mocked(askConflict).mockResolvedValue(null);
    await pressSave();
    wrapper.unmount();

    useDocumentsStore().sessionOf(tabId)!.hasConflict = true;
    await mountEditor();

    expect(askConflict).toHaveBeenCalledTimes(2);
  });
});

describe('TextEditor: suciedad y regreso a la pestaña', () => {
  it('volver al texto original deja «Guardado» y el botón deshabilitado', async () => {
    await openEditor();
    await type(EDITED);
    expect(chip().text()).toBe('Modificado');
    await type(ORIGINAL);
    expect(chip().text()).toBe('Guardado');
    expect(saveButton().attributes('disabled')).toBeDefined();
  });

  it('al volver a una pestaña sucia el editor se crea con lo escrito, sin releer el disco', async () => {
    await openEditor();
    await type(EDITED);
    wrapper.unmount();

    await mountEditor();

    expect(fsReadText).toHaveBeenCalledTimes(1);
    expect(openViewer).toHaveBeenCalledTimes(2);
    expect(openViewer.mock.calls[1][0].content).toBe(EDITED);
    expect(chip().text()).toBe('Modificado');
  });

  it('adopta el texto normalizado del editor como base para no ensuciar el archivo', async () => {
    await openEditor({ content: 'a\r\nb\nc\n', eol_mixed: true });
    editorText = 'a\nb\nc\n';
    wrapper.unmount();
    viewer.getContent.mockReturnValue('a\nb\nc\n');
    await mountEditor();
    expect(chip().text()).toBe('Guardado');
  });
});

describe('TextEditor: lectura', () => {
  it('muestra codificación, BOM y fin de línea en la barra de estado', async () => {
    await openEditor({ encoding: 'utf16_le', has_bom: true, eol: 'crlf' });
    const text = bar().text();
    expect(text).toContain('UTF-16 LE');
    expect(text).toContain('con BOM');
    expect(text).toContain('CRLF');
    expect(text).toContain('JavaScript');
    expect(text).toContain('Línea 1, columna 1');
  });

  it('no muestra aviso de EOL mixto cuando no lo es', async () => {
    await openEditor();
    expect(bar().find('[role="status"]').exists()).toBe(false);
  });

  it('actualiza la posición del cursor desde el editor', async () => {
    await openEditor();
    viewer.onCursorChange.mock.calls[0][0]({ line: 4, column: 9 });
    await flushPromises();
    expect(bar().text()).toContain('Línea 4, columna 9');
  });

  it('propaga el cambio de tema al editor', async () => {
    await openEditor();
    useTheme().toggleTheme();
    await flushPromises();
    expect(viewer.setTheme).toHaveBeenCalledWith(
      useTheme().resolvedTheme.value,
    );
  });
});

describe('TextEditor: flujo normal', () => {
  it('abre el documento editable con el contenido, el tema y la etiqueta accesible', async () => {
    await openEditor({ content: 'hola' });
    expect(openViewer).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'hola',
        path: PATH,
        label: 'Contenido de ejemplo.js',
        theme: useTheme().resolvedTheme.value,
        readOnly: false,
      }),
    );
    expect(chip().text()).toBe('Guardado');
    expect(bar().text()).toContain('Guardado');
  });

  it('editar, guardar con el botón y ver «Guardado» en el distintivo y la barra', async () => {
    await openEditor();
    await type(EDITED);
    expect(chip().text()).toBe('Modificado');
    expect(bar().text()).toContain('Modificado');
    vi.mocked(fsWriteText).mockResolvedValue({ version: 'v2' });

    await pressSave();

    expect(vi.mocked(fsWriteText).mock.calls[0][0]).toEqual({
      path: PATH,
      content: EDITED,
      encoding: 'utf8',
      has_bom: false,
      eol: 'lf',
      expected_version: 'v1',
    });
    expect(chip().text()).toBe('Guardado');
    expect(bar().text()).toContain('Guardado');
    expect(refreshStatus).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+S guarda desde el teclado', async () => {
    await openEditor();
    await type(EDITED);
    vi.mocked(fsWriteText).mockResolvedValue({ version: 'v2' });

    await wrapper
      .get('section')
      .trigger('keydown', { key: 's', ctrlKey: true });
    await flushPromises();

    expect(fsWriteText).toHaveBeenCalledTimes(1);
    expect(chip().text()).toBe('Guardado');
  });
});
