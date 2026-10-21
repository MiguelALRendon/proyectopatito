import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

const refreshStatus = vi.hoisted(() => vi.fn());
const hostSave = vi.hoisted(() => vi.fn());

vi.mock('../services/filesApi', () => ({
  fsWriteBytes: vi.fn(),
  fsProbe: vi.fn(),
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
}));
vi.mock('../documents/dialogs', () => ({
  askConflict: vi.fn(),
  askLegacyFidelity: vi.fn(),
  askSwitchOffice: vi.fn(),
  askWindowClose: vi.fn(),
  askLineEnding: vi.fn(),
}));
vi.mock('../documents/office/officeHost', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../documents/office/officeHost')>()),
  officeHost: { save: hostSave },
}));
vi.mock('../composables/useConfirm', () => ({ confirm: vi.fn() }));
vi.mock('./explorer', () => ({ useExplorerStore: () => ({ refreshStatus }) }));

import {
  askConflict,
  askLegacyFidelity,
  askSwitchOffice,
} from '../documents/dialogs';
import { MAX_OFFICE_BYTES } from '../documents/limits';
import { OfficeError } from '../documents/office/officeHost';
import { fsProbe, fsWriteBytes, type FileProbe } from '../services/filesApi';
import type { CommandError, ErrorKind } from '../services/tauri';
import { confirm } from '../composables/useConfirm';
import { useOfficeStore, type OfficeAttachment } from './office';
import { useTabsStore } from './tabs';

const PATH = 'wc\\informe.docx';
const BYTES = new Uint8Array([1, 2, 3]).buffer;

function failure(kind: ErrorKind, message = 'fallo'): CommandError {
  return { kind, message, codes: [], detail: null };
}

function written(version = 'v2') {
  return { version };
}

function probeOf(version: string | null): FileProbe {
  return {
    kind: 'office',
    mime: 'x',
    len: 1,
    extension: 'docx',
    has_macros: false,
    version,
  };
}

function setup(extra: Partial<OfficeAttachment> = {}, path = PATH) {
  setActivePinia(createPinia());
  const tabs = useTabsStore();
  const office = useOfficeStore();
  const tabId = tabs.open(path, 'document') as string;
  office.attach({
    tabId,
    path,
    docId: 'doc-1',
    ext: 'docx',
    kind: 'writer',
    version: 'v1',
    ...extra,
  });
  return { tabs, office, tabId };
}

function lastWrite() {
  const calls = vi.mocked(fsWriteBytes).mock.calls;
  return calls[calls.length - 1];
}

function dirty(office: ReturnType<typeof useOfficeStore>) {
  office.markModified('doc-1');
}

beforeEach(() => {
  vi.resetAllMocks();
  refreshStatus.mockResolvedValue(undefined);
  hostSave.mockResolvedValue(BYTES);
  vi.mocked(fsWriteBytes).mockResolvedValue(written());
});

describe('office: lo que no se puede guardar', () => {
  it('una pestaña sin sesión no se guarda', async () => {
    setActivePinia(createPinia());
    expect(await useOfficeStore().save('no-existe')).toBe('unavailable');
    expect(hostSave).not.toHaveBeenCalled();
  });

  it('un documento limpio no toca ni el iframe ni el disco', async () => {
    const { office, tabId } = setup();
    expect(await office.save(tabId)).toBe('unchanged');
    expect(hostSave).not.toHaveBeenCalled();
    expect(fsWriteBytes).not.toHaveBeenCalled();
  });

  it('dos guardados a la vez: el segundo está ocupado y solo se escribe una vez', async () => {
    const { office, tabId } = setup();
    dirty(office);
    let release: (bytes: ArrayBuffer) => void = () => undefined;
    hostSave.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const first = office.save(tabId);
    await nextTick();
    expect(await office.save(tabId)).toBe('busy');
    release(BYTES);
    expect(await first).toBe('saved');
    expect(fsWriteBytes).toHaveBeenCalledTimes(1);
  });

  it('un aviso de modificación de un documento desconocido no hace nada', () => {
    const { office, tabs, tabId } = setup();
    office.markModified('otro');
    expect(office.sessionOf(tabId)?.isDirty).toBe(false);
    expect(tabs.isDirty(tabId)).toBe(false);
    expect(Object.keys(office.sessions)).toEqual([tabId]);
    expect(office.dirtySessions()).toEqual([]);
  });

  it('el iframe que no entrega el documento deja un error recuperable y sigue sucio', async () => {
    const { office, tabId } = setup();
    dirty(office);
    hostSave.mockRejectedValue(new OfficeError('timeout'));
    expect(await office.save(tabId)).toBe('failed');
    const session = office.sessionOf(tabId);
    expect(session?.isDirty).toBe(true);
    expect(session?.isSaving).toBe(false);
    expect(session?.error?.message).toContain('ZetaOffice');
    expect(fsWriteBytes).not.toHaveBeenCalled();
  });

  it('bytes por encima del tope de Office no se envían a disco', async () => {
    const { office, tabId } = setup();
    dirty(office);
    hostSave.mockResolvedValue(new ArrayBuffer(MAX_OFFICE_BYTES + 1));
    expect(await office.save(tabId)).toBe('failed');
    expect(office.sessionOf(tabId)?.error?.kind).toBe('office_too_large');
    expect(fsWriteBytes).not.toHaveBeenCalled();
  });

  it('bytes exactamente en el tope sí se escriben', async () => {
    const { office, tabId } = setup();
    dirty(office);
    hostSave.mockResolvedValue(new ArrayBuffer(MAX_OFFICE_BYTES));
    expect(await office.save(tabId)).toBe('saved');
  });

  it.each<ErrorKind>(['io', 'working_copy_busy', 'file_locked', 'cloud_only'])(
    'un error %s no pierde los cambios y deja el aviso',
    async (kind) => {
      const { office, tabs, tabId } = setup();
      dirty(office);
      vi.mocked(fsWriteBytes).mockRejectedValue(failure(kind));
      expect(await office.save(tabId)).toBe('failed');
      const session = office.sessionOf(tabId);
      expect(session?.error?.kind).toBe(kind);
      expect(session?.isDirty).toBe(true);
      expect(tabs.isDirty(tabId)).toBe(true);
      expect(session?.isSaving).toBe(false);
    },
  );

  it('un archivo de solo lectura marca la sesión y se puede reintentar', async () => {
    const { office, tabId } = setup();
    dirty(office);
    vi.mocked(fsWriteBytes).mockRejectedValueOnce(failure('read_only'));
    expect(await office.save(tabId)).toBe('read-only');
    expect(office.sessionOf(tabId)?.isReadOnly).toBe(true);
    expect(await office.save(tabId)).toBe('saved');
    expect(office.sessionOf(tabId)?.isReadOnly).toBe(false);
  });

  it('un error que no es de la aplicación también se normaliza', async () => {
    const { office, tabId } = setup();
    dirty(office);
    vi.mocked(fsWriteBytes).mockRejectedValue(new Error('boom'));
    expect(await office.save(tabId)).toBe('failed');
    expect(office.sessionOf(tabId)?.error).not.toBeNull();
  });
});

describe('office: aviso de pérdida de fidelidad', () => {
  it('un formato antiguo pregunta una sola vez por sesión', async () => {
    const { office, tabId } = setup({ ext: 'doc' }, 'wc\\viejo.doc');
    vi.mocked(askLegacyFidelity).mockResolvedValue(true);
    dirty(office);
    expect(await office.save(tabId)).toBe('saved');
    dirty(office);
    expect(await office.save(tabId)).toBe('saved');
    expect(askLegacyFidelity).toHaveBeenCalledTimes(1);
  });

  it.each(['xls', 'ppt'] as const)('también para %s', async (ext) => {
    const { office, tabId } = setup({ ext }, `wc\\viejo.${ext}`);
    vi.mocked(askLegacyFidelity).mockResolvedValue(true);
    dirty(office);
    await office.save(tabId);
    expect(askLegacyFidelity).toHaveBeenCalledTimes(1);
  });

  it('cancelar el aviso no escribe nada y conserva los cambios', async () => {
    const { office, tabId } = setup({ ext: 'doc' }, 'wc\\viejo.doc');
    vi.mocked(askLegacyFidelity).mockResolvedValue(false);
    dirty(office);
    expect(await office.save(tabId)).toBe('failed');
    expect(hostSave).not.toHaveBeenCalled();
    expect(office.sessionOf(tabId)?.isDirty).toBe(true);
    expect(office.sessionOf(tabId)?.error).toBeNull();
  });

  it('cancelarlo una vez no impide aceptarlo después', async () => {
    const { office, tabId } = setup({ ext: 'doc' }, 'wc\\viejo.doc');
    vi.mocked(askLegacyFidelity).mockResolvedValueOnce(false);
    vi.mocked(askLegacyFidelity).mockResolvedValueOnce(true);
    dirty(office);
    await office.save(tabId);
    expect(await office.save(tabId)).toBe('saved');
  });

  it.each(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'] as const)(
    '%s no pregunta',
    async (ext) => {
      const { office, tabId } = setup({ ext });
      dirty(office);
      await office.save(tabId);
      expect(askLegacyFidelity).not.toHaveBeenCalled();
    },
  );
});

describe('office: conflicto con un cambio externo', () => {
  async function conflicted() {
    const context = setup();
    dirty(context.office);
    vi.mocked(fsWriteBytes).mockRejectedValueOnce(failure('file_changed'));
    return context;
  }

  it('el conflicto se marca y no pierde los cambios', async () => {
    const { office, tabId } = await conflicted();
    expect(await office.save(tabId)).toBe('conflict');
    expect(office.sessionOf(tabId)?.hasConflict).toBe(true);
    expect(office.sessionOf(tabId)?.isDirty).toBe(true);
  });

  it('cancelar el diálogo deja el conflicto y los cambios', async () => {
    const { office, tabId } = await conflicted();
    vi.mocked(askConflict).mockResolvedValue(null);
    expect(await office.saveResolvingConflict(tabId)).toBe('conflict');
    expect(office.sessionOf(tabId)?.isDirty).toBe(true);
    expect(fsWriteBytes).toHaveBeenCalledTimes(1);
  });

  it('sobrescribir relee la versión del disco y guarda encima', async () => {
    const { office, tabId } = await conflicted();
    vi.mocked(askConflict).mockResolvedValue('overwrite');
    vi.mocked(fsProbe).mockResolvedValue(probeOf('externa'));
    expect(await office.saveResolvingConflict(tabId)).toBe('saved');
    const last = lastWrite();
    expect(last?.[1]).toBe('externa');
    expect(office.sessionOf(tabId)?.version).toBe('v2');
    expect(office.sessionOf(tabId)?.hasConflict).toBe(false);
  });

  it('sobrescribir con una versión que no se puede leer falla sin escribir', async () => {
    const { office, tabId } = await conflicted();
    vi.mocked(askConflict).mockResolvedValue('overwrite');
    vi.mocked(fsProbe).mockRejectedValue(failure('io'));
    expect(await office.saveResolvingConflict(tabId)).toBe('failed');
    expect(fsWriteBytes).toHaveBeenCalledTimes(1);
  });

  it('sobrescribir cuando el archivo ya no tiene versión usa una versión vacía que Rust rechazará', async () => {
    const { office, tabId } = await conflicted();
    vi.mocked(askConflict).mockResolvedValue('overwrite');
    vi.mocked(fsProbe).mockResolvedValue(probeOf(null));
    vi.mocked(fsWriteBytes).mockRejectedValueOnce(failure('file_changed'));
    expect(await office.saveResolvingConflict(tabId)).toBe('conflict');
    expect(lastWrite()?.[1]).toBe('');
  });

  it('recargar descarta los cambios, limpia la pestaña y pide reabrir', async () => {
    const { office, tabs, tabId } = await conflicted();
    vi.mocked(askConflict).mockResolvedValue('reload');
    const before = office.sessionOf(tabId)?.reloadTicket ?? 0;
    expect(await office.saveResolvingConflict(tabId)).toBe('unchanged');
    const session = office.sessionOf(tabId);
    expect(session?.isDirty).toBe(false);
    expect(session?.hasConflict).toBe(false);
    expect(session?.reloadTicket).toBe(before + 1);
    expect(tabs.isDirty(tabId)).toBe(false);
  });

  it('sobrescribir sobre una sesión que ya está guardando no hace nada', async () => {
    const { office, tabId } = setup();
    dirty(office);
    let release: (bytes: ArrayBuffer) => void = () => undefined;
    hostSave.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const saving = office.save(tabId);
    await nextTick();
    expect(await office.overwrite(tabId)).toBe('unavailable');
    release(BYTES);
    await saving;
  });

  it('un guardado limpio sin conflicto no abre ningún diálogo', async () => {
    const { office, tabId } = setup();
    dirty(office);
    expect(await office.saveResolvingConflict(tabId)).toBe('saved');
    expect(askConflict).not.toHaveBeenCalled();
  });
});

describe('office: ediciones durante el guardado y guardados no solicitados', () => {
  it('una edición mientras se guarda deja el documento sucio al terminar', async () => {
    const { office, tabId } = setup();
    dirty(office);
    let release: (bytes: ArrayBuffer) => void = () => undefined;
    hostSave.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const saving = office.save(tabId);
    await nextTick();
    office.markModified('doc-1');
    release(BYTES);
    expect(await saving).toBe('saved');
    expect(office.sessionOf(tabId)?.isDirty).toBe(true);
    expect(office.sessionOf(tabId)?.hasEditsWhileSaving).toBe(false);
  });

  it('un guardado no solicitado se escribe a disco con los bytes recibidos', async () => {
    const { office, tabId } = setup();
    expect(await office.persistUnrequestedSave('doc-1', BYTES)).toBe('saved');
    const call = lastWrite();
    expect(call?.[0]).toBe(PATH);
    expect(call?.[1]).toBe('v1');
    expect(new Uint8Array(call?.[2] as Uint8Array)).toEqual(
      new Uint8Array(BYTES),
    );
    expect(office.sessionOf(tabId)?.version).toBe('v2');
  });

  it('si ese guardado falla el documento queda sucio aunque LibreOffice crea que está limpio', async () => {
    const { office, tabs, tabId } = setup();
    vi.mocked(fsWriteBytes).mockRejectedValue(failure('io'));
    expect(await office.persistUnrequestedSave('doc-1', BYTES)).toBe('failed');
    expect(office.sessionOf(tabId)?.isDirty).toBe(true);
    expect(tabs.isDirty(tabId)).toBe(true);
  });

  it('un guardado no solicitado de un documento desconocido o mientras se guarda se ignora', async () => {
    const { office, tabId } = setup();
    expect(await office.persistUnrequestedSave('otro', BYTES)).toBe(
      'unavailable',
    );
    dirty(office);
    let release: (bytes: ArrayBuffer) => void = () => undefined;
    hostSave.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const saving = office.save(tabId);
    await nextTick();
    expect(await office.persistUnrequestedSave('doc-1', BYTES)).toBe(
      'unavailable',
    );
    release(BYTES);
    await saving;
    expect(fsWriteBytes).toHaveBeenCalledTimes(1);
  });
});

describe('office: un solo documento vivo y cambio de pestaña', () => {
  function second(office: ReturnType<typeof useOfficeStore>) {
    const tabs = useTabsStore();
    return {
      tabs,
      other: tabs.open('wc\\otro.docx', 'document') as string,
      office,
    };
  }

  it('sin documento vivo o con el mismo, no hay nada que soltar', async () => {
    setActivePinia(createPinia());
    const office = useOfficeStore();
    expect(await office.releaseFor('x')).toBe(true);
    const context = setup();
    expect(await context.office.releaseFor(context.tabId)).toBe(true);
    expect(askSwitchOffice).not.toHaveBeenCalled();
  });

  it('un documento vivo limpio se suelta sin preguntar', async () => {
    const { office, tabId } = setup();
    const { other } = second(office);
    expect(await office.releaseFor(other)).toBe(true);
    expect(office.sessionOf(tabId)).toBeNull();
    expect(office.liveTabId).toBeNull();
    expect(askSwitchOffice).not.toHaveBeenCalled();
  });

  it('con cambios: cancelar conserva el documento vivo y sus cambios', async () => {
    const { office, tabId } = setup();
    const { other } = second(office);
    dirty(office);
    vi.mocked(askSwitchOffice).mockResolvedValue(null);
    expect(await office.releaseFor(other)).toBe(false);
    expect(office.sessionOf(tabId)?.isDirty).toBe(true);
    expect(office.liveTabId).toBe(tabId);
  });

  it('con cambios: descartar suelta el documento y limpia la marca de la pestaña', async () => {
    const { office, tabs, tabId } = setup();
    const { other } = second(office);
    dirty(office);
    vi.mocked(askSwitchOffice).mockResolvedValue('discard');
    expect(await office.releaseFor(other)).toBe(true);
    expect(office.sessionOf(tabId)).toBeNull();
    expect(tabs.isDirty(tabId)).toBe(false);
    expect(fsWriteBytes).not.toHaveBeenCalled();
  });

  it('con cambios: guardar escribe antes de soltar', async () => {
    const { office, tabId } = setup();
    const { other } = second(office);
    dirty(office);
    vi.mocked(askSwitchOffice).mockResolvedValue('save');
    expect(await office.releaseFor(other)).toBe(true);
    expect(fsWriteBytes).toHaveBeenCalledTimes(1);
    expect(office.sessionOf(tabId)).toBeNull();
  });

  it('con cambios: si guardar falla no se suelta nada', async () => {
    const { office, tabId } = setup();
    const { other } = second(office);
    dirty(office);
    vi.mocked(askSwitchOffice).mockResolvedValue('save');
    vi.mocked(fsWriteBytes).mockRejectedValue(failure('io'));
    expect(await office.releaseFor(other)).toBe(false);
    expect(office.sessionOf(tabId)?.isDirty).toBe(true);
    expect(office.liveTabId).toBe(tabId);
  });

  it('guardar con conflicto y cancelar el diálogo tampoco suelta nada', async () => {
    const { office, tabId } = setup();
    const { other } = second(office);
    dirty(office);
    vi.mocked(askSwitchOffice).mockResolvedValue('save');
    vi.mocked(fsWriteBytes).mockRejectedValue(failure('file_changed'));
    vi.mocked(askConflict).mockResolvedValue(null);
    expect(await office.releaseFor(other)).toBe(false);
    expect(office.liveTabId).toBe(tabId);
  });
});

describe('office: sesiones, pestañas y cierre', () => {
  it('adjuntar crea una sesión limpia y la declara viva', () => {
    const { office, tabs, tabId } = setup();
    const session = office.sessionOf(tabId);
    expect(session).toMatchObject({
      isDirty: false,
      isSaving: false,
      isReadOnly: false,
      hasConflict: false,
      version: 'v1',
    });
    expect(office.liveTabId).toBe(tabId);
    expect(office.hasLiveDocument).toBe(true);
    expect(tabs.isDirty(tabId)).toBe(false);
  });

  it('modificar marca la sesión y la pestaña, y es la lista de pendientes', () => {
    const { office, tabs, tabId } = setup();
    expect(office.dirtySessions()).toEqual([]);
    dirty(office);
    expect(tabs.isDirty(tabId)).toBe(true);
    expect(office.dirtySessions().map((s) => s.tabId)).toEqual([tabId]);
  });

  it('soltar una pestaña que no tiene sesión no falla', () => {
    const { office } = setup();
    expect(() => office.detach('otra')).not.toThrow();
  });

  it('cerrar la pestaña elimina la sesión y deja de haber documento vivo', async () => {
    const { office, tabs, tabId } = setup();
    dirty(office);
    vi.mocked(confirm).mockResolvedValue(true);
    expect(await tabs.close(tabId)).toBe(true);
    await nextTick();
    expect(office.sessionOf(tabId)).toBeNull();
    expect(office.hasLiveDocument).toBe(false);
  });

  it('cerrar la pestaña mientras se guarda espera al guardado y no pregunta si quedó limpia', async () => {
    const { office, tabs, tabId } = setup();
    dirty(office);
    let finish!: () => void;
    vi.mocked(fsWriteBytes).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve(written());
      }),
    );
    const saving = office.save(tabId);
    await vi.waitFor(() => expect(fsWriteBytes).toHaveBeenCalled());
    let isClosed = false;
    const closing = tabs.close(tabId).then((closed) => (isClosed = closed));
    await Promise.resolve();
    expect(isClosed).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    finish();
    await saving;
    expect(await closing).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(tabs.tabs.some((tab) => tab.id === tabId)).toBe(false);
  });

  it('si el guardado falla, cerrar pregunta si se descartan los cambios', async () => {
    const { office, tabs, tabId } = setup();
    dirty(office);
    vi.mocked(fsWriteBytes).mockRejectedValue(failure('io'));
    vi.mocked(confirm).mockResolvedValue(false);
    const saving = office.save(tabId);
    const closing = tabs.close(tabId);
    await saving;
    expect(await closing).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(tabs.tabs.some((tab) => tab.id === tabId)).toBe(true);
  });

  it('recargar una pestaña desconocida no falla', () => {
    const { office } = setup();
    expect(() => office.reload('otra')).not.toThrow();
  });

  it('camino feliz: modificar, guardar y quedar limpio con la versión nueva', async () => {
    const { office, tabs, tabId } = setup();
    dirty(office);
    expect(await office.save(tabId)).toBe('saved');
    const session = office.sessionOf(tabId);
    expect(session?.isDirty).toBe(false);
    expect(session?.version).toBe('v2');
    expect(tabs.isDirty(tabId)).toBe(false);
    expect(refreshStatus).toHaveBeenCalledTimes(1);
    expect(hostSave).toHaveBeenCalledWith('doc-1');
    expect(vi.mocked(fsWriteBytes).mock.calls[0][1]).toBe('v1');
  });
});
