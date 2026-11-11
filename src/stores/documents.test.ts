import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

const refreshStatus = vi.hoisted(() => vi.fn());

vi.mock('../services/filesApi', () => ({
  fsReadText: vi.fn(),
  fsWriteText: vi.fn(),
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
}));
vi.mock('../documents/dialogs', () => ({
  askWindowClose: vi.fn(),
  askLineEnding: vi.fn(),
}));
vi.mock('../composables/useConfirm', () => ({ confirm: vi.fn() }));
vi.mock('./explorer', () => ({ useExplorerStore: () => ({ refreshStatus }) }));

import { confirm } from '../composables/useConfirm';
import {
  fsReadText,
  fsWriteText,
  type TextDocument,
  type WriteTextRequest,
} from '../services/filesApi';
import type { CommandError, ErrorKind } from '../services/tauri';
import { SAVE_SETTLE_TIMEOUT_MS } from '../documents/limits';
import { isSettled, refusalOf, useDocumentsStore } from './documents';
import { useTabsStore } from './tabs';

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

function setup() {
  setActivePinia(createPinia());
  return { tabs: useTabsStore(), documents: useDocumentsStore() };
}

async function openDocument(extra: Partial<TextDocument> = {}) {
  const { tabs, documents } = setup();
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
  refreshStatus.mockResolvedValue(undefined);
});

describe('documents: escrituras que fallan no pierden el contenido', () => {
  it('un error de disco deja el texto, la suciedad y un error recuperable', async () => {
    const { tabs, documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockRejectedValue(failure('io', 'disco lleno'));

    expect(await documents.save(tabId)).toBe('failed');

    const session = documents.sessionOf(tabId);
    expect(session?.current).toBe(EDITED);
    expect(session?.isDirty).toBe(true);
    expect(session?.phase).toBe('ready');
    expect(session?.error?.message).toBe('disco lleno');
    expect(tabs.isDirty(tabId)).toBe(true);
    expect(refreshStatus).not.toHaveBeenCalled();
  });

  it('un error que no es de la forma esperada se normaliza y tampoco pierde datos', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockRejectedValue(new Error('se cayó'));

    expect(await documents.save(tabId)).toBe('failed');
    expect(documents.sessionOf(tabId)?.current).toBe(EDITED);
    expect(documents.sessionOf(tabId)?.error).not.toBeNull();
  });

  it.each(['file_locked', 'working_copy_busy'] as const)(
    '%s es reintentable: el segundo intento guarda y limpia el error',
    async (kind) => {
      const { documents, tabId } = await openDocument();
      documents.edit(tabId, EDITED);
      vi.mocked(fsWriteText).mockRejectedValueOnce(failure(kind));

      expect(await documents.save(tabId)).toBe('failed');
      expect(documents.sessionOf(tabId)?.error?.kind).toBe(kind);

      vi.mocked(fsWriteText).mockResolvedValueOnce({ version: 'v2' });
      expect(await documents.save(tabId)).toBe('saved');
      expect(documents.sessionOf(tabId)?.error).toBeNull();
      expect(documents.sessionOf(tabId)?.isDirty).toBe(false);
    },
  );
});

describe('documents: conflicto con un cambio externo', () => {
  it('FileChanged marca el conflicto, conserva el texto y no recarga solo', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockRejectedValue(failure('file_changed'));

    expect(await documents.save(tabId)).toBe('conflict');

    const session = documents.sessionOf(tabId);
    expect(session?.hasConflict).toBe(true);
    expect(session?.current).toBe(EDITED);
    expect(session?.version).toBe('v1');
    expect(fsReadText).toHaveBeenCalledTimes(1);
  });

  it('recargar en conflicto un archivo que ya no es texto pasa la sesión a failed', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockRejectedValue(failure('file_changed'));
    await documents.save(tabId);
    vi.mocked(fsReadText).mockRejectedValueOnce(failure('not_text'));

    expect(await documents.reload(tabId)).toBe(false);

    const session = documents.sessionOf(tabId);
    expect(session?.phase).toBe('failed');
    expect(session?.hasConflict).toBe(false);
  });

  it('cancelar el conflicto limpia la bandera y el siguiente guardado lo vuelve a detectar', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockRejectedValue(failure('file_changed'));
    await documents.save(tabId);

    documents.dismissConflict(tabId);
    expect(documents.sessionOf(tabId)?.hasConflict).toBe(false);
    expect(documents.sessionOf(tabId)?.isDirty).toBe(true);

    expect(await documents.save(tabId)).toBe('conflict');
    expect(documents.sessionOf(tabId)?.hasConflict).toBe(true);
  });

  it('recargar descarta los cambios, trae la versión del disco y deja la pestaña limpia', async () => {
    const { tabs, documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    const before = documents.sessionOf(tabId)?.revision ?? 0;
    vi.mocked(fsReadText).mockResolvedValueOnce(
      textDocument({ content: 'externo\n', version: 'v7' }),
    );

    expect(await documents.reload(tabId)).toBe(true);

    const session = documents.sessionOf(tabId);
    expect(session?.current).toBe('externo\n');
    expect(session?.original).toBe('externo\n');
    expect(session?.version).toBe('v7');
    expect(session?.isDirty).toBe(false);
    expect(session?.revision).toBe(before + 1);
    expect(tabs.isDirty(tabId)).toBe(false);
  });

  it('sobrescribir relee la versión actual y guarda encima con ella', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockRejectedValueOnce(failure('file_changed'));
    await documents.save(tabId);
    vi.mocked(fsReadText).mockResolvedValueOnce(
      textDocument({ content: 'externo\n', version: 'v9' }),
    );
    vi.mocked(fsWriteText).mockResolvedValueOnce({ version: 'v10' });

    expect(await documents.overwrite(tabId)).toBe('saved');

    expect(lastWrite().expected_version).toBe('v9');
    expect(lastWrite().content).toBe(EDITED);
    expect(documents.sessionOf(tabId)?.version).toBe('v10');
    expect(documents.sessionOf(tabId)?.hasConflict).toBe(false);
  });

  it('sobrescribir sin poder releer no escribe nada y no pierde el texto', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsReadText).mockRejectedValueOnce(failure('io', 'sin acceso'));

    expect(await documents.overwrite(tabId)).toBe('failed');

    expect(fsWriteText).not.toHaveBeenCalled();
    expect(documents.sessionOf(tabId)?.current).toBe(EDITED);
    expect(documents.sessionOf(tabId)?.error?.message).toBe('sin acceso');
  });

  it('si el archivo vuelve a cambiar durante la sobrescritura, el conflicto reaparece', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsReadText).mockResolvedValueOnce(
      textDocument({ version: 'v9' }),
    );
    vi.mocked(fsWriteText).mockRejectedValueOnce(failure('file_changed'));

    expect(await documents.overwrite(tabId)).toBe('conflict');
    expect(documents.sessionOf(tabId)?.hasConflict).toBe(true);
  });

  it('sobrescribir una sesión inexistente o que sigue cargando no hace nada', async () => {
    const { documents } = setup();
    expect(await documents.overwrite('no-existe')).toBe('unavailable');
    expect(fsReadText).not.toHaveBeenCalled();
  });
});

describe('documents: solo lectura', () => {
  it('ReadOnly pasa la sesión a solo lectura sin perder el texto ni la suciedad', async () => {
    const { tabs, documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockRejectedValue(failure('read_only'));

    expect(await documents.save(tabId)).toBe('read-only');

    const session = documents.sessionOf(tabId);
    expect(session?.isReadOnly).toBe(true);
    expect(session?.current).toBe(EDITED);
    expect(session?.isDirty).toBe(true);
    expect(session?.error).toBeNull();
    expect(tabs.isDirty(tabId)).toBe(true);
  });

  it('reintentar tras quitar el atributo guarda y sale del modo de solo lectura', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockRejectedValueOnce(failure('read_only'));
    await documents.save(tabId);

    vi.mocked(fsWriteText).mockResolvedValueOnce({ version: 'v2' });
    expect(await documents.save(tabId)).toBe('saved');
    expect(documents.sessionOf(tabId)?.isReadOnly).toBe(false);
  });

  it('recargar sale del modo de solo lectura', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockRejectedValueOnce(failure('read_only'));
    await documents.save(tabId);
    vi.mocked(fsReadText).mockResolvedValueOnce(textDocument());

    await documents.reload(tabId);
    expect(documents.sessionOf(tabId)?.isReadOnly).toBe(false);
  });
});

describe('documents: final de línea mixto', () => {
  it('no escribe hasta que el usuario decide y avisa con needs-eol', async () => {
    const { documents, tabId } = await openDocument({
      content: 'a\r\nb\nc\n',
      eol: 'lf',
      eol_mixed: true,
    });
    documents.edit(tabId, 'a\r\nb\nc\nd\n');

    expect(await documents.save(tabId)).toBe('needs-eol');
    expect(fsWriteText).not.toHaveBeenCalled();
    expect(documents.sessionOf(tabId)?.isDirty).toBe(true);
  });

  it('tras elegir el final de línea guarda con él y deja de avisar', async () => {
    const { documents, tabId } = await openDocument({
      content: 'a\r\nb\nc\n',
      eol: 'lf',
      eol_mixed: true,
    });
    documents.edit(tabId, 'a\r\nb\nc\nd\n');
    documents.setLineEnding(tabId, 'crlf');
    vi.mocked(fsWriteText).mockResolvedValueOnce({ version: 'v2' });

    expect(await documents.save(tabId)).toBe('saved');
    expect(lastWrite().eol).toBe('crlf');
    expect(documents.sessionOf(tabId)?.eolMixed).toBe(false);
  });

  it('un archivo mixto sin cambios no pide decisión', async () => {
    const { documents, tabId } = await openDocument({ eol_mixed: true });
    expect(await documents.save(tabId)).toBe('unchanged');
  });
});

describe('documents: respuestas atrasadas y estados imposibles', () => {
  it('un segundo guardado mientras se guarda espera al primero y escribe una sola vez', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    let finish: (value: { version: string }) => void = () => undefined;
    vi.mocked(fsWriteText).mockReturnValue(
      new Promise((done) => (finish = done)),
    );

    const first = documents.save(tabId);
    expect(documents.sessionOf(tabId)?.phase).toBe('saving');
    const second = documents.save(tabId);
    finish({ version: 'v2' });

    expect(await first).toBe('saved');
    expect(await second).toBe('saved');
    expect(fsWriteText).toHaveBeenCalledTimes(1);
  });

  it('lo editado durante un guardado se guarda al pedir otro y no se pierde', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    let finish: (value: { version: string }) => void = () => undefined;
    vi.mocked(fsWriteText)
      .mockReturnValueOnce(new Promise((done) => (finish = done)))
      .mockResolvedValueOnce({ version: 'v3' });

    const first = documents.save(tabId);
    documents.edit(tabId, `${EDITED} y más`);
    const second = documents.save(tabId);
    finish({ version: 'v2' });

    expect(await first).toBe('saved');
    expect(await second).toBe('saved');
    expect(fsWriteText).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fsWriteText).mock.calls[1]?.[0].content).toBe(
      `${EDITED} y más`,
    );
    expect(documents.sessionOf(tabId)?.isDirty).toBe(false);
  });

  it('un guardado de texto en curso se registra para que cerrar lo espere', async () => {
    const { documents, tabs, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    let finish: (value: { version: string }) => void = () => undefined;
    vi.mocked(fsWriteText).mockReturnValue(
      new Promise((done) => (finish = done)),
    );

    const saving = documents.save(tabId);
    expect(tabs.hasPendingSave([tabId])).toBe(true);
    finish({ version: 'v2' });
    await saving;

    expect(tabs.hasPendingSave([tabId])).toBe(false);
  });

  it('lo escrito mientras se guarda sigue sucio y conserva lo guardado como original', async () => {
    const { tabs, documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    let finish: (value: { version: string }) => void = () => undefined;
    vi.mocked(fsWriteText).mockReturnValue(
      new Promise((done) => (finish = done)),
    );

    const saving = documents.save(tabId);
    documents.edit(tabId, `${EDITED}cuatro\n`);
    finish({ version: 'v2' });
    await saving;

    const session = documents.sessionOf(tabId);
    expect(session?.original).toBe(EDITED);
    expect(session?.current).toBe(`${EDITED}cuatro\n`);
    expect(session?.isDirty).toBe(true);
    expect(tabs.isDirty(tabId)).toBe(true);
  });

  it('cerrar la pestaña mientras se guarda no resucita la sesión ni lanza', async () => {
    const { tabs, documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    let finish: (value: { version: string }) => void = () => undefined;
    vi.mocked(fsWriteText).mockReturnValue(
      new Promise((done) => (finish = done)),
    );

    vi.mocked(confirm).mockResolvedValue(true);
    vi.useFakeTimers();
    try {
      const saving = documents.save(tabId);
      const closing = tabs.close(tabId);
      await vi.advanceTimersByTimeAsync(SAVE_SETTLE_TIMEOUT_MS);
      await closing;
      await nextTick();
      finish({ version: 'v2' });

      await expect(saving).resolves.toBe('saved');
      expect(documents.sessionOf(tabId)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('la respuesta atrasada de una carga anterior no pisa la sesión nueva', async () => {
    const { tabs, documents } = setup();
    const tabId = tabs.open(PATH, 'document') as string;
    let finishOld: (value: TextDocument) => void = () => undefined;
    vi.mocked(fsReadText)
      .mockReturnValueOnce(new Promise((done) => (finishOld = done)))
      .mockResolvedValueOnce(textDocument({ content: 'nuevo\n' }));

    const old = documents.load(tabId, PATH);
    await documents.load(tabId, 'wc\\otro.txt');
    finishOld(textDocument({ content: 'viejo\n' }));
    await old;

    expect(documents.sessionOf(tabId)?.current).toBe('nuevo\n');
    expect(documents.sessionOf(tabId)?.path).toBe('wc\\otro.txt');
  });

  it('una recarga atrasada no pisa a la más reciente', async () => {
    const { documents, tabId } = await openDocument();
    let finishOld: (value: TextDocument) => void = () => undefined;
    vi.mocked(fsReadText)
      .mockReturnValueOnce(new Promise((done) => (finishOld = done)))
      .mockResolvedValueOnce(textDocument({ content: 'reciente\n' }));

    const old = documents.reload(tabId);
    await documents.reload(tabId);
    finishOld(textDocument({ content: 'viejo\n' }));

    expect(await old).toBe(false);
    expect(documents.sessionOf(tabId)?.current).toBe('reciente\n');
  });

  it('un guardado que arranca mientras se relee no se pisa cuando llega la lectura', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    let finishRead: (value: TextDocument) => void = () => undefined;
    let finishWrite: (value: { version: string }) => void = () => undefined;
    vi.mocked(fsReadText).mockReturnValueOnce(
      new Promise((done) => (finishRead = done)),
    );
    vi.mocked(fsWriteText).mockReturnValue(
      new Promise((done) => (finishWrite = done)),
    );

    const reloading = documents.reload(tabId);
    const saving = documents.save(tabId);
    finishRead(textDocument({ content: 'del disco\n', version: 'v9' }));

    expect(await reloading).toBe(false);
    expect(documents.sessionOf(tabId)?.phase).toBe('saving');
    expect(documents.sessionOf(tabId)?.current).toBe(EDITED);
    finishWrite({ version: 'v2' });
    expect(await saving).toBe('saved');
    expect(documents.sessionOf(tabId)?.original).toBe(EDITED);
    expect(documents.sessionOf(tabId)?.version).toBe('v2');
  });

  it('una lectura que falla después de empezar un guardado no marca el error', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    let failRead: (error: unknown) => void = () => undefined;
    vi.mocked(fsReadText).mockReturnValueOnce(
      new Promise((_, fail) => (failRead = fail)),
    );
    vi.mocked(fsWriteText).mockResolvedValue({ version: 'v2' });

    const reloading = documents.reload(tabId);
    await documents.save(tabId);
    failRead(failure('not_text'));

    expect(await reloading).toBe(false);
    expect(documents.sessionOf(tabId)?.phase).toBe('ready');
    expect(documents.sessionOf(tabId)?.error).toBeNull();
  });

  it('recargar mientras se guarda no hace nada', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockReturnValue(new Promise(() => undefined));

    void documents.save(tabId);

    expect(await documents.reload(tabId)).toBe(false);
    expect(fsReadText).toHaveBeenCalledTimes(1);
  });

  it('una carga que llega con la pestaña ya cerrada se descarta', async () => {
    const { tabs, documents } = setup();
    const tabId = tabs.open(PATH, 'document') as string;
    let finish: (value: TextDocument) => void = () => undefined;
    vi.mocked(fsReadText).mockReturnValue(
      new Promise((done) => (finish = done)),
    );

    const loading = documents.open(tabId, PATH);
    await tabs.close(tabId);
    await nextTick();
    finish(textDocument());
    await loading;

    expect(documents.sessionOf(tabId)).toBeNull();
  });

  it('no se puede guardar ni recargar una sesión que no existe, carga o falló', async () => {
    const { tabs, documents } = setup();
    const tabId = tabs.open(PATH, 'document') as string;
    vi.mocked(fsReadText).mockReturnValue(new Promise(() => undefined));
    void documents.load(tabId, PATH);

    expect(await documents.save('no-existe')).toBe('unavailable');
    expect(await documents.save(tabId)).toBe('unavailable');
    expect(await documents.reload(tabId)).toBe(false);
    expect(fsWriteText).not.toHaveBeenCalled();
  });

  it('editar una sesión que no existe o cargando no ensucia ninguna pestaña', async () => {
    const { tabs, documents } = setup();
    const tabId = tabs.open(PATH, 'document') as string;
    vi.mocked(fsReadText).mockReturnValue(new Promise(() => undefined));
    void documents.load(tabId, PATH);

    documents.edit('no-existe', 'x');
    documents.edit(tabId, 'x');
    documents.rebase(tabId, 'x');
    expect(tabs.hasDirtyTabs).toBe(false);
  });

  it('cambiar el final de línea o descartar un conflicto de una sesión inexistente no hace nada', () => {
    const { documents } = setup();
    expect(() => documents.setLineEnding('no-existe', 'crlf')).not.toThrow();
    expect(() => documents.dismissConflict('no-existe')).not.toThrow();
    expect(documents.sessionOf('no-existe')).toBeNull();
  });

  it('guardar sin cambios no escribe', async () => {
    const { documents, tabId } = await openDocument();
    expect(await documents.save(tabId)).toBe('unchanged');
    expect(fsWriteText).not.toHaveBeenCalled();
  });
});

describe('documents: errores al cargar y recargar', () => {
  it('una carga fallida deja la sesión en failed y abrir de nuevo reintenta', async () => {
    const { tabs, documents } = setup();
    const tabId = tabs.open(PATH, 'document') as string;
    vi.mocked(fsReadText).mockRejectedValueOnce(failure('io', 'sin permiso'));
    await documents.open(tabId, PATH);
    expect(documents.sessionOf(tabId)?.phase).toBe('failed');
    expect(documents.sessionOf(tabId)?.error?.message).toBe('sin permiso');

    vi.mocked(fsReadText).mockResolvedValueOnce(textDocument());
    await documents.open(tabId, PATH);
    expect(documents.sessionOf(tabId)?.phase).toBe('ready');
    expect(documents.sessionOf(tabId)?.error).toBeNull();
  });

  it.each(['not_text', 'too_large', 'cloud_only'] as const)(
    'si al recargar el archivo deja de ser editable (%s) la sesión pasa a failed',
    async (kind) => {
      const { tabs, documents, tabId } = await openDocument();
      documents.edit(tabId, EDITED);
      vi.mocked(fsReadText).mockRejectedValueOnce(failure(kind));

      expect(await documents.reload(tabId)).toBe(false);

      expect(documents.sessionOf(tabId)?.phase).toBe('failed');
      expect(documents.sessionOf(tabId)?.error?.kind).toBe(kind);
      expect(tabs.isDirty(tabId)).toBe(false);
    },
  );

  it.each(['not_text', 'too_large', 'cloud_only'] as const)(
    'si al recargar un documento sin cambios deja de ser editable (%s) la sesión pasa a failed',
    async (kind) => {
      const { documents, tabId } = await openDocument();
      vi.mocked(fsReadText).mockRejectedValueOnce(failure(kind));

      expect(await documents.reload(tabId)).toBe(false);

      expect(documents.sessionOf(tabId)?.phase).toBe('failed');
      expect(documents.sessionOf(tabId)?.error?.kind).toBe(kind);
    },
  );

  it('si la recarga falla por otra causa conserva el texto editado y el error', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsReadText).mockRejectedValueOnce(
      failure('io', 'se fue el disco'),
    );

    expect(await documents.reload(tabId)).toBe(false);

    const session = documents.sessionOf(tabId);
    expect(session?.phase).toBe('ready');
    expect(session?.current).toBe(EDITED);
    expect(session?.isDirty).toBe(true);
    expect(session?.error?.message).toBe('se fue el disco');
  });

  it('abrir una pestaña que ya tiene la sesión lista no relee el archivo ni pierde los cambios', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);

    await documents.open(tabId, PATH);

    expect(fsReadText).toHaveBeenCalledTimes(1);
    expect(documents.sessionOf(tabId)?.current).toBe(EDITED);
  });

  it('abrir la misma pestaña con otra ruta descarta la sesión anterior y limpia la suciedad', async () => {
    const { tabs, documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    vi.mocked(fsReadText).mockResolvedValueOnce(
      textDocument({ content: 'otro\n' }),
    );

    await documents.open(tabId, 'wc\\otro.txt');

    expect(documents.sessionOf(tabId)?.current).toBe('otro\n');
    expect(tabs.isDirty(tabId)).toBe(false);
  });
});

describe('documents: suciedad', () => {
  it('volver al texto original deja la pestaña limpia', async () => {
    const { tabs, documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);
    expect(tabs.isDirty(tabId)).toBe(true);

    documents.edit(tabId, ORIGINAL);
    expect(documents.sessionOf(tabId)?.isDirty).toBe(false);
    expect(tabs.isDirty(tabId)).toBe(false);
  });

  it('rebase sobre una sesión limpia adopta el texto normalizado del editor sin ensuciarla', async () => {
    const { tabs, documents, tabId } = await openDocument({
      content: 'a\r\nb\nc\n',
      eol_mixed: true,
    });

    documents.rebase(tabId, 'a\nb\nc\n');

    expect(documents.sessionOf(tabId)?.original).toBe('a\nb\nc\n');
    expect(documents.sessionOf(tabId)?.isDirty).toBe(false);
    expect(tabs.hasDirtyTabs).toBe(false);
  });

  it('rebase sobre una sesión sucia conserva el original', async () => {
    const { documents, tabId } = await openDocument();
    documents.edit(tabId, EDITED);

    documents.rebase(tabId, `${EDITED}x\n`);

    expect(documents.sessionOf(tabId)?.original).toBe(ORIGINAL);
    expect(documents.sessionOf(tabId)?.current).toBe(`${EDITED}x\n`);
    expect(documents.sessionOf(tabId)?.isDirty).toBe(true);
  });

  it('cerrar una pestaña elimina su sesión', async () => {
    const { tabs, documents, tabId } = await openDocument();
    await tabs.close(tabId);
    await nextTick();
    expect(documents.sessionOf(tabId)).toBeNull();
  });
});

describe('documents: reglas puras', () => {
  it('refusalOf distingue cada motivo para no guardar', async () => {
    const { documents, tabId } = await openDocument();
    const session = documents.sessionOf(tabId);
    if (!session) throw new Error('falta la sesión');
    expect(refusalOf({ ...session, phase: 'saving' })).toBe('unavailable');
    expect(refusalOf({ ...session, phase: 'loading' })).toBe('unavailable');
    expect(refusalOf({ ...session, phase: 'failed' })).toBe('unavailable');
    expect(refusalOf(session)).toBe('unchanged');
    expect(refusalOf({ ...session, isDirty: true, eolMixed: true })).toBe(
      'needs-eol',
    );
    expect(refusalOf({ ...session, isDirty: true })).toBeNull();
  });

  it('solo saved y unchanged cuentan como resueltos', () => {
    expect(isSettled('saved')).toBe(true);
    expect(isSettled('unchanged')).toBe(true);
    expect(isSettled('conflict')).toBe(false);
  });
});

describe('documents: flujo normal', () => {
  it('abre, edita y guarda con la versión esperada, y avisa al explorador', async () => {
    const { tabs, documents, tabId } = await openDocument();
    expect(documents.sessionOf(tabId)).toMatchObject({
      phase: 'ready',
      original: ORIGINAL,
      version: 'v1',
      isDirty: false,
    });

    documents.edit(tabId, EDITED);
    expect(tabs.isDirty(tabId)).toBe(true);
    vi.mocked(fsWriteText).mockResolvedValueOnce({ version: 'v2' });

    expect(await documents.save(tabId)).toBe('saved');

    expect(lastWrite()).toEqual({
      path: PATH,
      content: EDITED,
      encoding: 'utf8',
      has_bom: false,
      eol: 'lf',
      expected_version: 'v1',
    });
    expect(documents.sessionOf(tabId)).toMatchObject({
      original: EDITED,
      version: 'v2',
      isDirty: false,
      phase: 'ready',
    });
    expect(tabs.isDirty(tabId)).toBe(false);
    expect(refreshStatus).toHaveBeenCalledTimes(1);
  });

  it('conserva codificación, BOM y final de línea del archivo en cada guardado', async () => {
    const { documents, tabId } = await openDocument({
      encoding: 'utf16_le',
      has_bom: true,
      eol: 'crlf',
    });
    documents.edit(tabId, EDITED);
    vi.mocked(fsWriteText).mockResolvedValue({ version: 'v2' });
    await documents.save(tabId);
    documents.edit(tabId, `${EDITED}x`);
    await documents.save(tabId);

    expect(lastWrite()).toMatchObject({
      encoding: 'utf16_le',
      has_bom: true,
      eol: 'crlf',
      expected_version: 'v2',
    });
  });
});
