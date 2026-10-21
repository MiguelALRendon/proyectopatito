import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';

const host = vi.hoisted(() => ({
  mount: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  save: vi.fn(),
  destroy: vi.fn(),
  destroyOwned: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock('../../documents/office/officeHost', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../documents/office/officeHost')
  >()),
  officeHost: host,
}));
vi.mock('../../documents/office/officeSupport', () => ({
  isOfficeSupported: vi.fn(),
}));
vi.mock('../../services/filesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/filesApi')>()),
  fsProbe: vi.fn(),
  fsWriteBytes: vi.fn(),
  uiStateGet: vi.fn(),
  uiStateSet: vi.fn(),
}));
vi.mock('../../documents/dialogs', () => ({
  askConflict: vi.fn(),
  askLegacyFidelity: vi.fn(),
  askSwitchOffice: vi.fn(),
  askWindowClose: vi.fn(),
  askLineEnding: vi.fn(),
}));
vi.mock('../../composables/useConfirm', () => ({ confirm: vi.fn() }));
vi.mock('../../stores/explorer', () => ({
  useExplorerStore: () => ({ refreshStatus: vi.fn() }),
}));

import { askSwitchOffice } from '../../documents/dialogs';
import { MAX_OFFICE_BYTES } from '../../documents/limits';
import { OfficeError } from '../../documents/office/officeHost';
import type { OfficeEvent } from '../../documents/office/officeHost';
import { isOfficeSupported } from '../../documents/office/officeSupport';
import { DOCUMENT_TAB_KEY } from '../../documents/tabContext';
import { fsProbe, fsWriteBytes, type FileProbe } from '../../services/filesApi';
import { useOfficeStore } from '../../stores/office';
import { useTabsStore } from '../../stores/tabs';
import OfficeViewer from './OfficeViewer.vue';

const PATH = 'wc\\informe.docx';
const OWNER = 7;

function probeOf(extra: Partial<FileProbe> = {}): FileProbe {
  return {
    kind: 'office',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    len: 1000,
    extension: 'docx',
    has_macros: false,
    version: 'v1',
    ...extra,
  };
}

let pinia: Pinia;
let wrapper: VueWrapper;
let listener: ((event: OfficeEvent) => void) | null;
const unsubscribe = vi.fn();

async function show(path = PATH, probe = probeOf(), tabPath = path) {
  const tabs = useTabsStore();
  const tabId = tabs.open(tabPath, 'document') as string;
  wrapper = mount(OfficeViewer, {
    props: { path, probe },
    attachTo: document.body,
    global: {
      plugins: [pinia],
      provide: { [DOCUMENT_TAB_KEY as symbol]: tabId },
    },
  });
  await flushPromises();
  return { tabs, tabId, office: useOfficeStore() };
}

function emit(event: OfficeEvent) {
  listener?.(event);
}

beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  listener = null;
  vi.mocked(isOfficeSupported).mockReturnValue(true);
  host.mount.mockResolvedValue(OWNER);
  host.open.mockResolvedValue('writer');
  host.close.mockResolvedValue(undefined);
  host.save.mockResolvedValue(new Uint8Array([1, 2]).buffer);
  host.destroy.mockResolvedValue(undefined);
  host.destroyOwned.mockResolvedValue(undefined);
  host.subscribe.mockImplementation((next: (event: OfficeEvent) => void) => {
    listener = next;
    return unsubscribe;
  });
  vi.mocked(fsWriteBytes).mockResolvedValue({ version: 'v2' });
  vi.mocked(fsProbe).mockResolvedValue(probeOf({ version: 'fresca' }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
});

afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
});

describe('OfficeViewer: caminos de fallo primero', () => {
  it('un documento sobre el tope se ofrece como binario sin cargar nada', async () => {
    await show(PATH, probeOf({ len: MAX_OFFICE_BYTES + 1 }));
    expect(wrapper.text()).toContain('tamaño máximo');
    expect(wrapper.find('article.binary-card').exists()).toBe(true);
    expect(host.mount).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exactamente en el tope sí se intenta abrir', async () => {
    await show(PATH, probeOf({ len: MAX_OFFICE_BYTES }));
    expect(host.mount).toHaveBeenCalledTimes(1);
  });

  it('un WebView sin aislamiento cae a la tarjeta con el aviso de WebView2', async () => {
    vi.mocked(isOfficeSupported).mockReturnValue(false);
    await show();
    expect(wrapper.text()).toContain('WebView2');
    expect(host.mount).not.toHaveBeenCalled();
  });

  it('una extensión fuera de las nueve cae a la tarjeta', async () => {
    await show('wc\\raro.rtf', probeOf({ extension: 'rtf' }));
    expect(wrapper.find('article.binary-card').exists()).toBe(true);
    expect(host.open).not.toHaveBeenCalled();
  });

  it('un archivo sin versión no se abre', async () => {
    await show(PATH, probeOf({ version: null }));
    expect(wrapper.find('article.binary-card').exists()).toBe(true);
    expect(host.open).not.toHaveBeenCalled();
  });

  it('si el archivo no se puede leer, destruye el iframe y avisa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x', { status: 500 })),
    );
    await show();
    expect(host.destroy).toHaveBeenCalled();
    expect(wrapper.text()).toContain('No se pudo leer el archivo');
    expect(host.open).not.toHaveBeenCalled();
  });

  it.each([
    ['timeout', 'tardó demasiado'],
    ['boot-failed', 'No se pudo iniciar'],
    ['open-failed', 'está dañado'],
  ] as const)(
    'el fallo %s muestra su aviso, con detalle, y suelta la sesión',
    async (code, text) => {
      host.open.mockRejectedValue(new OfficeError(code, 'detalle-técnico'));
      const { office, tabId } = await show();
      expect(wrapper.text()).toContain(text);
      expect(wrapper.text()).toContain('(detalle-técnico)');
      expect(host.destroy).toHaveBeenCalled();
      expect(office.sessionOf(tabId)).toBeNull();
    },
  );

  it('un fallo al montar el iframe también cae a la tarjeta', async () => {
    host.mount.mockRejectedValue(new OfficeError('boot-failed'));
    await show();
    expect(wrapper.text()).toContain('No se pudo iniciar');
  });

  it('si otro documento tiene cambios y se cancela, el visor queda en espera y vuelve a esa pestaña', async () => {
    const first = await show('wc\\a.docx', probeOf());
    first.office.markModified(first.office.sessionOf(first.tabId)?.docId ?? '');
    vi.mocked(askSwitchOffice).mockResolvedValue(null);
    host.mount.mockClear();
    const firstWrapper = wrapper;
    const tabs = useTabsStore();
    const second = tabs.open('wc\\b.docx', 'document') as string;
    wrapper = mount(OfficeViewer, {
      props: { path: 'wc\\b.docx', probe: probeOf() },
      attachTo: document.body,
      global: {
        plugins: [pinia],
        provide: { [DOCUMENT_TAB_KEY as symbol]: second },
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('reabrirá');
    expect(host.mount).not.toHaveBeenCalled();
    expect(tabs.activeTab?.id).toBe(first.tabId);
    firstWrapper.unmount();
  });

  it('si el visor se desmonta mientras el iframe aún monta, no envía el documento', async () => {
    let finish: (owner: number) => void = () => undefined;
    host.mount.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await show();
    wrapper.unmount();
    finish(OWNER);
    await flushPromises();
    expect(host.open).not.toHaveBeenCalled();
  });

  it('si se desmonta mientras abre, un fallo posterior no cambia nada ni destruye dos veces', async () => {
    let fail: (error: unknown) => void = () => undefined;
    host.open.mockReturnValue(
      new Promise((_resolve, reject) => (fail = reject)),
    );
    await show();
    wrapper.unmount();
    const destroyed = host.destroy.mock.calls.length;
    fail(new OfficeError('timeout'));
    await flushPromises();
    expect(host.destroy).toHaveBeenCalledTimes(destroyed);
  });
});

describe('OfficeViewer: guardar y estado', () => {
  it('abre el documento y registra la sesión con la versión del sondeo', async () => {
    const { office, tabId } = await show();
    expect(host.mount).toHaveBeenCalledWith(
      wrapper.get('.office-viewer__stage').element,
    );
    const [docId, ext, bytes] = host.open.mock.calls[0];
    expect(ext).toBe('docx');
    expect(new Uint8Array(bytes as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(office.sessionOf(tabId)).toMatchObject({
      docId,
      version: 'v1',
      kind: 'writer',
    });
    expect(wrapper.get('.office-viewer__stage').attributes('data-phase')).toBe(
      'ready',
    );
    expect(wrapper.get('.office-viewer__stage').attributes('data-kind')).toBe(
      'writer',
    );
  });

  it('limpio: el chip dice «Guardado» y el botón está desactivado', async () => {
    await show();
    expect(wrapper.get('.office-viewer__chip').text()).toBe('Guardado');
    expect(wrapper.get('button.btn').attributes('disabled')).toBeDefined();
  });

  it('una modificación avisada por el iframe activa «Modificado» y «Guardar»', async () => {
    const { office, tabId } = await show();
    const docId = office.sessionOf(tabId)?.docId as string;
    emit({ cmd: 'modified', docId });
    await flushPromises();
    expect(wrapper.get('.office-viewer__chip').text()).toBe('Modificado');
    expect(wrapper.get('button.btn').attributes('disabled')).toBeUndefined();
  });

  it('el botón Guardar pide los bytes al iframe y los escribe con la versión esperada', async () => {
    const { office, tabId } = await show();
    const docId = office.sessionOf(tabId)?.docId as string;
    emit({ cmd: 'modified', docId });
    await flushPromises();
    await wrapper.get('button.btn').trigger('click');
    await flushPromises();
    expect(host.save).toHaveBeenCalledWith(docId);
    expect(vi.mocked(fsWriteBytes).mock.calls[0][1]).toBe('v1');
    expect(office.sessionOf(tabId)?.version).toBe('v2');
    expect(wrapper.get('.office-viewer__chip').text()).toBe('Guardado');
  });

  it('mientras guarda, el chip dice «Guardando…» y el botón queda desactivado y ocupado', async () => {
    const { office, tabId } = await show();
    const docId = office.sessionOf(tabId)?.docId as string;
    emit({ cmd: 'modified', docId });
    await flushPromises();
    vi.mocked(fsWriteBytes).mockReturnValueOnce(new Promise(() => undefined));
    await wrapper.get('button.btn').trigger('click');
    await flushPromises();
    expect(wrapper.get('.office-viewer__chip').text()).toBe('Guardando…');
    const button = wrapper.get('button.btn');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('aria-busy')).toBe('true');
  });

  it('Ctrl+S sobre el visor guarda y no deja pasar el atajo', async () => {
    const { office, tabId } = await show();
    emit({ cmd: 'modified', docId: office.sessionOf(tabId)?.docId as string });
    await flushPromises();
    await wrapper
      .get('.office-viewer__body')
      .trigger('keydown', { key: 's', ctrlKey: true });
    await flushPromises();
    expect(fsWriteBytes).toHaveBeenCalledTimes(1);
  });

  it('save-requested del iframe (Ctrl+S dentro de ZetaOffice) también guarda', async () => {
    const { office, tabId } = await show();
    const docId = office.sessionOf(tabId)?.docId as string;
    emit({ cmd: 'modified', docId });
    emit({ cmd: 'save-requested', docId });
    await flushPromises();
    expect(fsWriteBytes).toHaveBeenCalledTimes(1);
  });

  it('un guardado no solicitado del iframe se escribe a disco', async () => {
    const { office, tabId } = await show();
    const docId = office.sessionOf(tabId)?.docId as string;
    emit({
      cmd: 'saved',
      docId,
      requested: false,
      bytes: new Uint8Array([4]).buffer,
    });
    await flushPromises();
    expect(fsWriteBytes).toHaveBeenCalledTimes(1);
  });

  it('un fallo de escritura muestra el aviso con «Reintentar» y no pierde los cambios', async () => {
    vi.mocked(fsWriteBytes).mockRejectedValue({
      kind: 'working_copy_busy',
      message: 'ocupada',
      codes: [],
      detail: null,
    });
    const { office, tabId } = await show();
    emit({ cmd: 'modified', docId: office.sessionOf(tabId)?.docId as string });
    await flushPromises();
    await wrapper.get('button.btn').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'copia de trabajo está ocupada',
    );
    expect(wrapper.get('.office-viewer__chip').text()).toBe('Modificado');
  });

  it('un archivo de solo lectura lo avisa y muestra el chip', async () => {
    vi.mocked(fsWriteBytes).mockRejectedValue({
      kind: 'read_only',
      message: 'ro',
      codes: [],
      detail: null,
    });
    const { office, tabId } = await show();
    emit({ cmd: 'modified', docId: office.sessionOf(tabId)?.docId as string });
    await flushPromises();
    await wrapper.get('button.btn').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Solo lectura');
    expect(wrapper.get('[role="alert"]').text()).toContain('solo lectura');
  });

  it('un documento con macros muestra el aviso persistente y uno sin macros no', async () => {
    await show(PATH, probeOf({ has_macros: true }));
    expect(wrapper.text()).toContain('no se ejecutan');
    wrapper.unmount();
    await show(PATH, probeOf({ has_macros: false }));
    expect(wrapper.text()).not.toContain('macros');
  });

  it('avisa cuando una acción queda bloqueada y no antes', async () => {
    await show();
    expect(wrapper.text()).not.toContain('no está disponible');
    emit({ cmd: 'blocked', command: '.uno:Open' });
    await flushPromises();
    expect(wrapper.text()).toContain('no está disponible en el visor');
    expect(wrapper.get('[data-command]').attributes('data-command')).toBe(
      '.uno:Open',
    );
  });

  it('el progreso se muestra en porcentaje y se ignora el total cero', async () => {
    let finish: (kind: string) => void = () => undefined;
    host.open.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await show();
    expect(wrapper.get('.office-viewer__loading').text()).toBe(
      'Abriendo el documento…',
    );
    emit({ cmd: 'progress', loaded: 1, total: 4 });
    emit({ cmd: 'progress', loaded: 0, total: 0 });
    await flushPromises();
    expect(wrapper.get('.office-viewer__loading').text()).toContain('25 %');
    finish('calc');
    await flushPromises();
    expect(wrapper.get('.office-viewer__stage').attributes('data-kind')).toBe(
      'calc',
    );
  });
});

describe('OfficeViewer: recarga, relevo y cierre', () => {
  it('recargar cierra el documento, relee versión y bytes y lo vuelve a abrir', async () => {
    const { office, tabId } = await show();
    const oldDoc = office.sessionOf(tabId)?.docId as string;
    office.reload(tabId);
    await flushPromises();
    expect(host.close).toHaveBeenCalledWith(oldDoc);
    expect(fsProbe).toHaveBeenCalledWith(PATH);
    expect(host.open).toHaveBeenCalledTimes(2);
    const session = office.sessionOf(tabId);
    expect(session?.version).toBe('fresca');
    expect(session?.docId).not.toBe(oldDoc);
    expect(session?.isDirty).toBe(false);
  });

  it('si al recargar el archivo ya no es Office, cae a la tarjeta', async () => {
    const { office, tabId } = await show();
    vi.mocked(fsProbe).mockResolvedValue(probeOf({ version: null }));
    office.reload(tabId);
    await flushPromises();
    expect(wrapper.find('article.binary-card').exists()).toBe(true);
    expect(office.sessionOf(tabId)).toBeNull();
  });

  it('si otro documento libera esta sesión, el visor queda en espera y reabre al volver', async () => {
    const { office, tabs, tabId } = await show();
    office.detach(tabId);
    await flushPromises();
    expect(wrapper.get('.office-viewer__stage').attributes('data-phase')).toBe(
      'idle',
    );
    expect(wrapper.text()).toContain('reabrirá');
    const other = tabs.open('wc\\otro.docx', 'document') as string;
    expect(tabs.activeTab?.id).toBe(other);
    await flushPromises();
    host.mount.mockClear();
    tabs.activate(tabId);
    await flushPromises();
    expect(host.mount).toHaveBeenCalledTimes(1);
    expect(office.sessionOf(tabId)).not.toBeNull();
  });

  it('al desmontar suelta la sesión, se da de baja y solo destruye su propio iframe', async () => {
    const { office, tabId } = await show();
    wrapper.unmount();
    expect(office.sessionOf(tabId)).toBeNull();
    expect(unsubscribe).toHaveBeenCalled();
    expect(host.destroyOwned).toHaveBeenCalledWith(OWNER);
  });

  it('desmontar un visor que nunca llegó a montar el iframe no destruye nada', async () => {
    vi.mocked(isOfficeSupported).mockReturnValue(false);
    await show();
    wrapper.unmount();
    expect(host.destroyOwned).not.toHaveBeenCalled();
  });
});
