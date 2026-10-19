import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../services/filesApi', () => ({
  fsReadText: vi.fn(),
  fsWriteText: vi.fn(),
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
}));
vi.mock('./dialogs', () => ({
  askWindowClose: vi.fn(),
  askLineEnding: vi.fn(),
}));
vi.mock('../composables/useConfirm', () => ({ confirm: vi.fn() }));
vi.mock('../stores/explorer', () => ({
  useExplorerStore: () => ({ refreshStatus: vi.fn() }),
}));

import { useDocumentsStore } from '../stores/documents';
import { useOfficeStore } from '../stores/office';
import { useTabsStore } from '../stores/tabs';
import {
  fsReadText,
  fsWriteText,
  type TextDocument,
  type WriteTextRequest,
} from '../services/filesApi';
import type { CommandError, ErrorKind } from '../services/tauri';
import { askLineEnding, askWindowClose } from './dialogs';
import { confirmWindowClose, saveAll } from './windowClose';

const PATH = 'wc\\notas.txt';
const ORIGINAL = 'uno\ndos\n';
const EDITED = 'uno\ndos\ntres\n';

function failure(kind: ErrorKind, message = 'fallo'): CommandError {
  return { kind, message, codes: [], detail: null };
}

function textDocument(extra: Partial<TextDocument> = {}): TextDocument {
  return {
    content: ORIGINAL,
    encoding: 'utf8',
    has_bom: false,
    eol: 'lf',
    eol_mixed: false,
    version: 'v1',
    len: ORIGINAL.length,
    ...extra,
  };
}

async function openDocument(extra: Partial<TextDocument> = {}) {
  setActivePinia(createPinia());
  const tabs = useTabsStore();
  const documents = useDocumentsStore();
  const tabId = tabs.open(PATH, 'document') as string;
  vi.mocked(fsReadText).mockResolvedValueOnce(textDocument(extra));
  await documents.open(tabId, PATH);
  return { tabs, documents, tabId };
}

function lastWrite(): WriteTextRequest {
  const calls = vi.mocked(fsWriteText).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('windowClose: cierre de la ventana', () => {
  it('sin cambios vacía lo pendiente y deja cerrar sin preguntar', async () => {
    const { tabs } = await openDocument();
    const flush = vi.spyOn(tabs, 'flush');

    expect(await confirmWindowClose()).toBe(true);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(askWindowClose).not.toHaveBeenCalled();
  });

  it('con cambios y cancelar no cierra ni pierde nada', async () => {
    const { tabs, documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(askWindowClose).mockResolvedValue(null);

    expect(await confirmWindowClose()).toBe(false);

    expect(askWindowClose).toHaveBeenCalledWith(1);
    expect(fsWriteText).not.toHaveBeenCalled();
    expect(documents.sessionOf(tabId)?.current).toBe(EDITED);
    expect(tabs.isDirty(tabId)).toBe(true);
  });

  it('descartar deja cerrar sin escribir', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(askWindowClose).mockResolvedValue('discard');

    expect(await confirmWindowClose()).toBe(true);
    expect(fsWriteText).not.toHaveBeenCalled();
  });

  it('guardar y cerrar escribe todas las pestañas sucias antes de dejar cerrar', async () => {
    const { tabs, documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(askWindowClose).mockResolvedValue('save');
    vi.mocked(fsWriteText).mockResolvedValue({ version: 'v2' });

    expect(await confirmWindowClose()).toBe(true);

    expect(lastWrite().content).toBe(EDITED);
    expect(tabs.hasDirtyTabs).toBe(false);
  });

  it('si al guardar falla una pestaña no cierra, la activa y conserva sus cambios', async () => {
    const { tabs, documents, tabId } = await openDocument();
    const other = tabs.open('wc\\b.txt', 'document') as string;
    vi.mocked(fsReadText).mockResolvedValueOnce(textDocument());
    await documents.open(other, 'wc\\b.txt');
    documents.edit(tabId, EDITED);
    tabs.activate(other);
    vi.mocked(askWindowClose).mockResolvedValue('save');
    vi.mocked(fsWriteText).mockRejectedValue(failure('file_changed'));

    expect(await confirmWindowClose()).toBe(false);

    expect(tabs.activeId).toBe(tabId);
    expect(documents.sessionOf(tabId)?.hasConflict).toBe(true);
    expect(documents.sessionOf(tabId)?.current).toBe(EDITED);
  });

  it('un archivo con final de línea mixto sin decidir impide el cierre en vez de normalizar a escondidas', async () => {
    const { documents, tabId } = await openDocument({ eol_mixed: true });
    documents.edit(tabId, EDITED);
    vi.mocked(askWindowClose).mockResolvedValue('save');

    expect(await confirmWindowClose()).toBe(false);
    expect(fsWriteText).not.toHaveBeenCalled();
  });

  it('un final de línea mixto en «Guardar y cerrar» pregunta con el mismo diálogo y guarda con la elección', async () => {
    const { documents, tabId } = await openDocument({
      content: 'a\r\nb\n',
      eol_mixed: true,
    });
    documents.edit(tabId, 'a\r\nb\nc\n');
    vi.mocked(askWindowClose).mockResolvedValue('save');
    vi.mocked(askLineEnding).mockResolvedValue('crlf');
    vi.mocked(fsWriteText).mockResolvedValue({ version: 'v2' });

    expect(await confirmWindowClose()).toBe(true);

    expect(askLineEnding).toHaveBeenCalledWith('notas.txt', 'lf');
    expect(lastWrite().eol).toBe('crlf');
  });

  it('cancelar la pregunta del final de línea cancela el cierre, activa la pestaña y no escribe', async () => {
    const { tabs, documents, tabId } = await openDocument({ eol_mixed: true });
    const other = tabs.open('wc\\b.txt', 'document') as string;
    tabs.activate(other);
    documents.edit(tabId, EDITED);
    vi.mocked(askWindowClose).mockResolvedValue('save');
    vi.mocked(askLineEnding).mockResolvedValue(null);

    expect(await confirmWindowClose()).toBe(false);

    expect(tabs.activeId).toBe(tabId);
    expect(fsWriteText).not.toHaveBeenCalled();
    expect(documents.sessionOf(tabId)?.isDirty).toBe(true);
  });

  it('saveAll sin nada sucio es verdadero y no escribe', async () => {
    await openDocument();
    expect(await saveAll()).toBe(true);
    expect(fsWriteText).not.toHaveBeenCalled();
  });
});

describe('windowClose con documentos de Office', () => {
  function withOffice(markModified = true) {
    setActivePinia(createPinia());
    const tabs = useTabsStore();
    const office = useOfficeStore();
    const tabId = tabs.open('wc\\informe.docx', 'document') as string;
    office.attach({
      tabId,
      path: 'wc\\informe.docx',
      docId: 'doc-1',
      ext: 'docx',
      kind: 'writer',
      version: 'v1',
    });
    if (markModified) office.markModified('doc-1');
    return { tabs, office, tabId };
  }

  it('sin cambios en Office la ventana se cierra sin preguntar', async () => {
    withOffice(false);
    expect(await confirmWindowClose()).toBe(true);
    expect(askWindowClose).not.toHaveBeenCalled();
  });

  it('un documento de Office con cambios cuenta como pendiente', async () => {
    withOffice();
    vi.mocked(askWindowClose).mockResolvedValue('discard');
    expect(await confirmWindowClose()).toBe(true);
    expect(askWindowClose).toHaveBeenCalledWith(1);
  });

  it('cancelar el diálogo conserva la ventana abierta', async () => {
    withOffice();
    vi.mocked(askWindowClose).mockResolvedValue(null);
    expect(await confirmWindowClose()).toBe(false);
  });

  it('guardar todo guarda el de Office resolviendo conflictos y no toca el servicio de texto', async () => {
    const { office, tabId } = withOffice();
    const save = vi
      .spyOn(office, 'saveResolvingConflict')
      .mockResolvedValue('saved');
    expect(await saveAll()).toBe(true);
    expect(save).toHaveBeenCalledWith(tabId);
    expect(fsWriteText).not.toHaveBeenCalled();
  });

  it('si el guardado de Office no se completa, activa esa pestaña y no cierra', async () => {
    const { office, tabs, tabId } = withOffice();
    tabs.open('wc\\otra.txt', 'document');
    vi.spyOn(office, 'saveResolvingConflict').mockResolvedValue('conflict');
    expect(await saveAll()).toBe(false);
    expect(tabs.activeTab?.id).toBe(tabId);
  });

  it('con un documento de texto y uno de Office con cambios guarda los dos', async () => {
    const { tabs, documents, tabId } = await openDocument();
    const office = useOfficeStore();
    const officeTab = tabs.open('wc\\informe.docx', 'document') as string;
    office.attach({
      tabId: officeTab,
      path: 'wc\\informe.docx',
      docId: 'doc-9',
      ext: 'docx',
      kind: 'writer',
      version: 'v1',
    });
    office.markModified('doc-9');
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockResolvedValue({ version: 'v2' });
    const save = vi
      .spyOn(office, 'saveResolvingConflict')
      .mockResolvedValue('saved');
    expect(await saveAll()).toBe(true);
    expect(save).toHaveBeenCalledWith(officeTab);
    expect(lastWrite().content).toBe(EDITED);
  });
});
