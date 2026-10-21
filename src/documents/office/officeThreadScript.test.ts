import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const SOURCE = readFileSync('src-tauri/assets/zeta/office_thread.js', 'utf-8');
const WRITER = 'com.sun.star.text.TextDocument';
const DETAIL_LIMIT = 200;

interface Posted {
  cmd: string;
  [key: string]: unknown;
}
interface Dispatch {
  dispatch(): void;
}
interface Interceptor {
  queryDispatch(
    url: { Complete: string },
    target: string,
    flags: number,
  ): Dispatch | null | string;
}
interface Listener {
  modified?: () => void;
  documentEventOccured?: (event: { EventName: string }) => void;
}

class PropertyValue {
  Name = '';
  Value: unknown = null;
  constructor(init: { Name: string; Value: unknown }) {
    Object.assign(this, init);
  }
}

function fakeModel(services: string[] = [WRITER]) {
  const listeners: Listener = {};
  const frame = {
    registerDispatchProviderInterceptor: vi.fn(),
    getContainerWindow: () => ({ setPosSize: vi.fn() }),
  };
  const state = { modified: false };
  return {
    listeners,
    state,
    frame,
    supportsService: (service: string) => services.includes(service),
    addModifyListener: (listener: Listener) =>
      Object.assign(listeners, { modified: listener.modified }),
    addDocumentEventListener: (listener: Listener) =>
      Object.assign(listeners, {
        documentEventOccured: listener.documentEventOccured,
      }),
    isModified: () => state.modified,
    getCurrentController: () => ({ getFrame: () => frame }),
    store: vi.fn(),
    close: vi.fn(),
  };
}

type Model = ReturnType<typeof fakeModel>;

async function boot(load: () => Model | null) {
  const posted: Posted[] = [];
  const interceptors: Interceptor[] = [];
  const mainPort = {
    postMessage: (message: Posted) => posted.push(message),
    onmessage: null as null | ((event: { data: Posted }) => void),
  };
  const desktop = {
    loadComponentFromURL: vi.fn(load),
    registerDispatchProviderInterceptor: (interceptor: Interceptor) =>
      interceptors.push(interceptor),
  };
  const css = {
    beans: { PropertyValue },
    frame: {
      Desktop: { create: () => desktop },
      XDispatch: 'XDispatch',
      XDispatchProviderInterceptor: 'XDispatchProviderInterceptor',
    },
    document: { XDocumentEventListener: 'XDocumentEventListener' },
    util: { XModifyListener: 'XModifyListener' },
  };
  const zetajs = {
    uno: { com: { sun: { star: css } } },
    getUnoComponentContext: () => ({}),
    unoObject: (_types: unknown, implementation: object) => implementation,
    mainPort,
  };
  const loaded = Promise.resolve(zetajs);
  new Function('Module', 'console', SOURCE)(
    { zetajs: loaded },
    { error: vi.fn() },
  );
  await loaded;
  const send = (data: Posted) => mainPort.onmessage?.({ data });
  return { posted, interceptors, desktop, send };
}

async function opened(model: Model = fakeModel()) {
  const harness = await boot(() => model);
  harness.send({ cmd: 'open', name: 'doc.docx' });
  return { ...harness, model };
}

describe('office_thread.js: apertura', () => {
  it('carga el documento sin ejecutar macros ni actualizar vínculos', async () => {
    const { desktop } = await opened();
    const [url, target, flags, props] = desktop.loadComponentFromURL.mock
      .calls[0] as unknown as [string, string, number, PropertyValue[]];
    expect([url, target, flags]).toEqual([
      'file:///tmp/office/doc.docx',
      '_default',
      0,
    ]);
    const values = Object.fromEntries(props.map((p) => [p.Name, p.Value]));
    expect(values).toEqual({
      MacroExecutionMode: 0,
      UpdateDocMode: 0,
      ReadOnly: false,
    });
  });

  it('informa Writer, Calc, Impress y unknown según el servicio', async () => {
    const cases: [string, string][] = [
      ['com.sun.star.text.TextDocument', 'writer'],
      ['com.sun.star.sheet.SpreadsheetDocument', 'calc'],
      ['com.sun.star.presentation.PresentationDocument', 'impress'],
      ['com.sun.star.drawing.DrawingDocument', 'unknown'],
    ];
    for (const [service, kind] of cases) {
      const { posted } = await opened(fakeModel([service]));
      expect(posted).toContainEqual({ cmd: 'opened', kind });
    }
  });

  it('responde failed si no hay modelo', async () => {
    const harness = await boot(() => null);
    harness.send({ cmd: 'open', name: 'doc.docx' });
    expect(harness.posted).toEqual([
      { cmd: 'failed', detail: 'documento no cargado' },
    ]);
  });

  it('responde failed con detalle de 200 caracteres como máximo si el manejador lanza', async () => {
    const harness = await boot(() => {
      throw new Error('x'.repeat(500));
    });
    harness.send({ cmd: 'open', name: 'doc.docx' });
    const failure = harness.posted[0];
    expect(failure.cmd).toBe('failed');
    expect(String(failure.detail)).toHaveLength(DETAIL_LIMIT);
  });

  it('ignora comandos desconocidos o heredados del prototipo', async () => {
    const harness = await boot(() => fakeModel());
    harness.send({ cmd: 'constructor' });
    harness.send({ cmd: 'toString' });
    harness.send({ cmd: 'nada' });
    expect(harness.posted).toEqual([]);
  });
});

describe('office_thread.js: interceptor de comandos', () => {
  function queryAll(harness: Awaited<ReturnType<typeof opened>>) {
    const [desktopInterceptor] = harness.interceptors;
    return (command: string) =>
      desktopInterceptor.queryDispatch({ Complete: command }, '', 0);
  }

  it.each([
    'service:com.sun.star.script.provider',
    'http://ejemplo.test/',
    'https://ejemplo.test/',
    'ftp://ejemplo.test/',
    'file:///c:/secreto.txt',
    'vnd.sun.star.script:Macro?language=Basic',
    '.uno:OpenHyperlink',
    '.uno:SaveAs',
  ])('bloquea %s y avisa al anfitrión', async (command) => {
    const harness = await opened();
    const dispatch = queryAll(harness)(command) as Dispatch;
    dispatch.dispatch();
    expect(harness.posted).toContainEqual({ cmd: 'blocked', command });
  });

  function listed(name: string): string[] {
    const body = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(
      SOURCE,
    )?.[1];
    return [...(body ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]);
  }

  it('bloquea cada comando de la lista BLOCKED, uno por uno', async () => {
    const commands = listed('BLOCKED');
    expect(commands.length).toBeGreaterThan(50);
    const harness = await opened();
    const query = queryAll(harness);
    for (const command of commands) {
      const dispatch = query(command) as Dispatch;
      dispatch.dispatch();
      expect(harness.posted, command).toContainEqual({
        cmd: 'blocked',
        command,
      });
    }
  });

  it('bloquea cualquier comando que empiece por un prefijo de BLOCKED_PREFIXES', async () => {
    const prefixes = listed('BLOCKED_PREFIXES');
    expect(prefixes).toEqual(
      expect.arrayContaining([
        'private:',
        'macro:',
        'mailto:',
        '.uno:Export',
        '.uno:SendMail',
      ]),
    );
    const harness = await opened();
    const query = queryAll(harness);
    for (const prefix of prefixes) {
      const command = `${prefix}inventado`;
      (query(command) as Dispatch).dispatch();
      expect(harness.posted, command).toContainEqual({
        cmd: 'blocked',
        command,
      });
    }
  });

  it('sin proveedor siguiente, un comando permitido devuelve null', async () => {
    const harness = await opened();
    const result = queryAll(harness)('.uno:Bold');
    expect(result).toBeNull();
  });

  it('desvía .uno:Save al flujo de guardado de la aplicación', async () => {
    const harness = await opened();
    const dispatch = queryAll(harness)('.uno:Save') as Dispatch;
    dispatch.dispatch();
    expect(harness.posted).toContainEqual({ cmd: 'save-requested' });
  });

  it('deja pasar un comando permitido al proveedor siguiente', async () => {
    const harness = await opened();
    const [desktopInterceptor] = harness.interceptors;
    const slave = { queryDispatch: vi.fn(() => 'propio') };
    (
      desktopInterceptor as unknown as {
        setSlaveDispatchProvider(provider: unknown): void;
      }
    ).setSlaveDispatchProvider(slave);
    expect(
      desktopInterceptor.queryDispatch({ Complete: '.uno:Bold' }, 'a', 1),
    ).toBe('propio');
    expect(slave.queryDispatch).toHaveBeenCalled();
  });
});

describe('office_thread.js: cambios y guardado', () => {
  it('avisa de modified fuera de un guardado propio', async () => {
    const { posted, model } = await opened();
    model.state.modified = true;
    model.listeners.modified?.();
    expect(posted).toContainEqual({ cmd: 'modified' });
  });

  it('no emite modified mientras guarda y sí después', async () => {
    const harness = await opened();
    const { model, posted, send } = harness;
    model.state.modified = true;
    model.store.mockImplementation(() => model.listeners.modified?.());
    send({ cmd: 'save' });
    expect(posted.filter((m) => m.cmd === 'modified')).toEqual([]);
    expect(posted).toContainEqual({ cmd: 'stored', requested: true });
    model.listeners.modified?.();
    expect(posted.filter((m) => m.cmd === 'modified')).toHaveLength(1);
  });

  it('informa como no solicitado un OnSaveDone que no viene de nuestro guardado', async () => {
    const { posted, model } = await opened();
    model.listeners.documentEventOccured?.({ EventName: 'OnSaveDone' });
    expect(posted).toContainEqual({ cmd: 'stored', requested: false });
  });

  it('no duplica el aviso cuando OnSaveDone llega durante nuestro guardado', async () => {
    const { posted, model, send } = await opened();
    model.store.mockImplementation(() =>
      model.listeners.documentEventOccured?.({ EventName: 'OnSaveDone' }),
    );
    send({ cmd: 'save' });
    expect(posted.filter((m) => m.cmd === 'stored')).toEqual([
      { cmd: 'stored', requested: true },
    ]);
  });

  it('ignora otros eventos del documento', async () => {
    const { posted, model } = await opened();
    model.listeners.documentEventOccured?.({ EventName: 'OnModifyChanged' });
    expect(posted.filter((m) => m.cmd === 'stored')).toEqual([]);
  });
});
