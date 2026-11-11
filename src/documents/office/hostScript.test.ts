import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const SOURCE = readFileSync('src-tauri/assets/zeta/host.js', 'utf-8');
const INIT = 'dakedaduck-office-init';
const OFFICE_DIR = '/tmp/office';

interface Msg {
  cmd: string;
  [key: string]: unknown;
}
interface Port {
  postMessage(message: Msg, transfer?: unknown[]): void;
  onmessage: null | ((event: { data: Msg }) => void);
}
interface FakeScript {
  src: string;
  onload: () => void;
  onerror: () => void;
}

function fakePort(sent: Msg[]): Port {
  return { postMessage: (message) => void sent.push(message), onmessage: null };
}

interface BootOptions {
  rangeStatus?: number;
  rangeBytes?: number;
  rangeTotal?: number;
  hooks?: boolean;
  failScript?: string;
}

const CHUNK = 8 * 1024 * 1024;

function rangeResponse(options: BootOptions, range?: string) {
  const start = Number(/bytes=(\d+)-/.exec(range ?? '')?.[1] ?? 0);
  const total = options.rangeTotal ?? options.rangeBytes ?? 10;
  const length = options.rangeTotal
    ? Math.min(CHUNK, total - start)
    : (options.rangeBytes ?? 10);
  return {
    status: options.rangeStatus ?? 206,
    ok: false,
    headers: {
      get: () => `bytes ${start}-${start + length - 1}/${total}`,
    },
    arrayBuffer: async () => new ArrayBuffer(length),
  };
}

function createHost(options: BootOptions = {}) {
  const parent = {};
  const toPage: Msg[] = [];
  const toWorker: Msg[] = [];
  const page = fakePort(toPage);
  const worker = fakePort(toWorker);
  const files = new Map<string, Uint8Array>();
  const FS = {
    mkdirTree: vi.fn(),
    writeFile: (path: string, bytes: Uint8Array) => void files.set(path, bytes),
    unlink: (path: string) => void files.delete(path),
    readFile: (path: string) => files.get(path) as Uint8Array,
  };
  const listeners: Record<string, (event: unknown) => void> = {};
  const win: Record<string, unknown> = {
    parent,
    focus: vi.fn(),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener;
    },
  };
  const canvas = { addEventListener: vi.fn() };
  const doc = {
    getElementById: () => canvas,
    createElement: (): FakeScript => ({
      src: '',
      onload: () => {},
      onerror: () => {},
    }),
    body: {
      appendChild: (script: FakeScript) => {
        const module = win.Module as { uno_main?: Promise<Port> };
        if (script.src.endsWith('soffice.js')) {
          module.uno_main = Promise.resolve(worker);
        }
        const fails =
          options.failScript && script.src.endsWith(options.failScript);
        queueMicrotask(fails ? script.onerror : script.onload);
      },
    },
  };
  const fetchStub = vi.fn(
    async (
      _name: string,
      init?: { method?: string; headers?: { Range?: string } },
    ) =>
      init?.method === 'HEAD'
        ? { ok: options.hooks === true }
        : rangeResponse(options, init?.headers?.Range),
  );
  new Function(
    'window',
    'document',
    'FS',
    'fetch',
    'location',
    'crypto',
    'innerWidth',
    'innerHeight',
    SOURCE,
  )(
    win,
    doc,
    FS,
    fetchStub,
    { href: 'http://zeta-assets.localhost/host.html' },
    {
      randomUUID: () => 'uuid-1',
    },
    800,
    600,
  );
  const init = (
    overrides: Partial<{ source: unknown; ports: Port[]; data: unknown }> = {},
  ) =>
    listeners.message({
      data: { type: INIT },
      source: parent,
      ports: [page],
      ...overrides,
    });
  const emit = (type: string) => listeners[type]?.({});
  return {
    page,
    worker,
    toPage,
    toWorker,
    files,
    init,
    parent,
    win,
    fetchStub,
    emit,
  };
}

async function readyHost(options: BootOptions = {}) {
  const host = createHost(options);
  host.init();
  await vi.waitFor(() => expect(host.toPage).toContainEqual({ cmd: 'ready' }));
  return host;
}

function fromPage(host: Awaited<ReturnType<typeof readyHost>>, data: unknown) {
  host.page.onmessage?.({ data: data as Msg });
}

function open(host: Awaited<ReturnType<typeof readyHost>>, docId = 'a') {
  fromPage(host, {
    cmd: 'open',
    docId,
    ext: 'docx',
    bytes: new ArrayBuffer(4),
  });
}

function codes(host: Awaited<ReturnType<typeof readyHost>>) {
  return host.toPage.filter((m) => m.cmd === 'error').map((m) => m.code);
}

describe('host.js: arranque', () => {
  it('ignora un arranque que no viene de la página padre', async () => {
    const host = createHost();
    host.init({ source: {} });
    await Promise.resolve();
    expect(host.page.onmessage).toBeNull();
    expect(host.toPage).toEqual([]);
  });

  it.each([
    ['sin puertos', 0],
    ['con dos puertos', 2],
  ])('ignora un arranque %s', async (_name, count) => {
    const host = createHost();
    const ports = Array.from({ length: count }, () => host.page);
    host.init({ ports });
    await Promise.resolve();
    expect(host.page.onmessage).toBeNull();
  });

  it('ignora un mensaje que no es dakedaduck-office-init', async () => {
    for (const data of [undefined, null, { type: 'otro' }]) {
      const host = createHost();
      host.init({ data });
      await Promise.resolve();
      expect(host.page.onmessage).toBeNull();
    }
  });

  it('acepta el puerto de la página una sola vez', async () => {
    const host = await readyHost();
    const second = fakePort([]);
    host.init({ ports: [second] });
    expect(second.onmessage).toBeNull();
  });

  it('responde boot-failed si una descarga no devuelve 206', async () => {
    const host = createHost({ rangeStatus: 200 });
    host.init();
    await vi.waitFor(() => expect(codes(host)).toEqual(['boot-failed']));
  });

  it('responde boot-failed si la descarga llega vacía', async () => {
    const host = createHost({ rangeBytes: 0 });
    host.init();
    await vi.waitFor(() => expect(codes(host)).toEqual(['boot-failed']));
  });

  it('responde boot-failed si un script no carga', async () => {
    const host = createHost({ failScript: 'soffice.js' });
    host.init();
    await vi.waitFor(() => expect(codes(host)).toEqual(['boot-failed']));
  });
});

describe('host.js: comandos de la página', () => {
  it.each([
    ['desconocido', { cmd: 'format-disk' }],
    ['heredado del prototipo', { cmd: 'constructor' }],
    ['toString', { cmd: 'toString' }],
    ['sin cmd', {}],
  ])('responde invalid-message a un comando %s', async (_name, data) => {
    const host = await readyHost();
    fromPage(host, data);
    expect(codes(host)).toEqual(['invalid-message']);
  });

  it.each([
    ['extensión fuera de las nueve', { ext: 'exe', bytes: new ArrayBuffer(4) }],
    [
      'extensión heredada del prototipo',
      { ext: 'constructor', bytes: new ArrayBuffer(4) },
    ],
    ['bytes vacíos', { ext: 'docx', bytes: new ArrayBuffer(0) }],
    ['bytes que no son ArrayBuffer', { ext: 'docx', bytes: new Uint8Array(4) }],
    ['sin bytes', { ext: 'docx' }],
  ])('rechaza un open con %s', async (_name, fields) => {
    const host = await readyHost();
    fromPage(host, { cmd: 'open', docId: 'a', ...fields });
    expect(codes(host)).toEqual(['invalid-message']);
    expect(host.toWorker).toEqual([]);
  });

  it('responde busy a un open con un documento ya abierto', async () => {
    const host = await readyHost();
    open(host, 'a');
    open(host, 'b');
    expect(codes(host)).toEqual(['busy']);
    expect(host.toWorker).toEqual([{ cmd: 'open', name: 'uuid-1.docx' }]);
  });

  it('rechaza un save de otro docId o de un documento que aún no está abierto', async () => {
    const host = await readyHost();
    fromPage(host, { cmd: 'save', docId: 'a' });
    open(host, 'a');
    fromPage(host, { cmd: 'save', docId: 'a' });
    host.worker.onmessage?.({ data: { cmd: 'opened', kind: 'writer' } });
    fromPage(host, { cmd: 'save', docId: 'otro' });
    expect(codes(host)).toEqual([
      'invalid-message',
      'invalid-message',
      'invalid-message',
    ]);
    expect(host.toWorker.filter((m) => m.cmd === 'save')).toEqual([]);
  });

  it('responde closed a un close de un docId que no es el vivo', async () => {
    const host = await readyHost();
    open(host, 'a');
    fromPage(host, { cmd: 'close', docId: 'otro' });
    expect(host.toPage).toContainEqual({ cmd: 'closed', docId: 'otro' });
    expect(host.toWorker.filter((m) => m.cmd === 'close')).toEqual([]);
  });
});

describe('host.js: ciclo de vida del documento', () => {
  it('escribe el documento en /tmp/office con nombre UUID y lo borra al cerrarse', async () => {
    const host = await readyHost();
    open(host);
    const path = `${OFFICE_DIR}/uuid-1.docx`;
    expect([...host.files.keys()]).toEqual([path]);
    host.worker.onmessage?.({ data: { cmd: 'opened', kind: 'writer' } });
    fromPage(host, { cmd: 'close', docId: 'a' });
    host.worker.onmessage?.({ data: { cmd: 'closed' } });
    expect(host.files.size).toBe(0);
    expect(host.toPage).toContainEqual({ cmd: 'closed', docId: 'a' });
  });

  it('responde open-failed y descarta el archivo si el worker falla al abrir', async () => {
    const host = await readyHost();
    open(host);
    host.worker.onmessage?.({ data: { cmd: 'failed', detail: 'roto' } });
    expect(host.files.size).toBe(0);
    expect(host.toPage).toContainEqual({
      cmd: 'error',
      code: 'open-failed',
      detail: 'roto',
      docId: 'a',
    });
    open(host, 'b');
    expect(codes(host)).toEqual(['open-failed']);
  });

  it('responde save-failed fuera de la apertura y el documento vuelve a open', async () => {
    const host = await readyHost();
    open(host);
    host.worker.onmessage?.({ data: { cmd: 'opened', kind: 'writer' } });
    fromPage(host, { cmd: 'save', docId: 'a' });
    host.worker.onmessage?.({ data: { cmd: 'failed', detail: 'disco' } });
    expect(codes(host)).toEqual(['save-failed']);
    expect(host.files.size).toBe(1);
    fromPage(host, { cmd: 'save', docId: 'a' });
    expect(host.toWorker.filter((m) => m.cmd === 'save')).toHaveLength(2);
  });
});

describe('host.js: guardado y avisos del worker', () => {
  async function openHost() {
    const host = await readyHost();
    open(host);
    host.worker.onmessage?.({ data: { cmd: 'opened', kind: 'writer' } });
    return host;
  }

  it('al guardar entrega una copia de los bytes del sistema de archivos, con requested y docId', async () => {
    const host = await openHost();
    fromPage(host, { cmd: 'save', docId: 'a' });
    expect(host.toWorker).toContainEqual({ cmd: 'save' });
    host.files.set(OFFICE_DIR + '/uuid-1.docx', new Uint8Array([9, 8, 7]));
    host.worker.onmessage?.({ data: { cmd: 'stored', requested: true } });
    const saved = host.toPage.find((m) => m.cmd === 'saved') as Msg;
    expect(saved).toMatchObject({ docId: 'a', requested: true });
    const bytes = saved.bytes as ArrayBuffer;
    expect([...new Uint8Array(bytes)]).toEqual([9, 8, 7]);
    host.files.get(OFFICE_DIR + '/uuid-1.docx')?.fill(0);
    expect([...new Uint8Array(bytes)]).toEqual([9, 8, 7]);
  });

  it('un guardado no solicitado conserva requested en falso', async () => {
    const host = await openHost();
    host.worker.onmessage?.({ data: { cmd: 'stored', requested: false } });
    const saved = host.toPage.find((m) => m.cmd === 'saved') as Msg;
    expect(saved.requested).toBe(false);
  });

  it('reenvía modified, blocked y save-requested a la página', async () => {
    const host = await openHost();
    host.worker.onmessage?.({ data: { cmd: 'modified' } });
    host.worker.onmessage?.({
      data: { cmd: 'blocked', command: '.uno:Print' },
    });
    host.worker.onmessage?.({ data: { cmd: 'save-requested' } });
    expect(host.toPage).toEqual(
      expect.arrayContaining([
        { cmd: 'modified', docId: 'a' },
        { cmd: 'blocked', command: '.uno:Print' },
        { cmd: 'save-requested', docId: 'a' },
      ]),
    );
  });

  it('ajusta la ventana al abrir y, con retardo, al redimensionar', async () => {
    vi.useFakeTimers();
    try {
      const host = await openHost();
      const fits = () => host.toWorker.filter((m) => m.cmd === 'fit');
      expect(fits()).toEqual([{ cmd: 'fit', w: 798, h: 600 }]);
      host.emit('resize');
      host.emit('resize');
      expect(fits()).toHaveLength(1);
      vi.advanceTimersByTime(150);
      expect(fits()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('un evento del worker sin documento abierto se ignora', async () => {
    const host = await readyHost();
    host.worker.onmessage?.({ data: { cmd: 'modified' } });
    host.worker.onmessage?.({ data: { cmd: 'constructor' } });
    expect(host.toPage.filter((m) => m.cmd === 'modified')).toEqual([]);
  });

  it('descarga los archivos grandes por tramos de 8 MiB hasta completarlos', async () => {
    const host = createHost({ rangeTotal: CHUNK + 10 });
    host.init();
    await vi.waitFor(() =>
      expect(host.toPage).toContainEqual({ cmd: 'ready' }),
    );
    const starts = host.fetchStub.mock.calls
      .map(([name, init]) => [name, init?.headers?.Range])
      .filter(([, range]) => range !== undefined);
    expect(starts).toEqual(
      expect.arrayContaining([
        ['soffice.wasm', `bytes=${CHUNK}-${2 * CHUNK - 1}`],
        ['soffice.data', `bytes=${CHUNK}-${2 * CHUNK - 1}`],
      ]),
    );
    const progress = host.toPage.filter((m) => m.cmd === 'progress');
    expect(progress[progress.length - 1]).toMatchObject({
      loaded: 2 * (CHUNK + 10),
      total: 2 * (CHUNK + 10),
    });
  });

  it('con los ganchos de prueba disponibles también carga sus scripts', async () => {
    const host = createHost({ hooks: true });
    host.init();
    await vi.waitFor(() =>
      expect(host.toPage).toContainEqual({ cmd: 'ready' }),
    );
    const module = host.win.Module as { uno_scripts: string[] };
    expect(module.uno_scripts.map((url) => url.split('/').pop())).toEqual([
      'zeta.js',
      'office_thread.js',
      'office_test_thread.js',
    ]);
  });

  it('sin ganchos de prueba solo carga zeta.js y office_thread.js', async () => {
    const host = await readyHost();
    const module = host.win.Module as { uno_scripts: string[] };
    expect(module.uno_scripts.map((url) => url.split('/').pop())).toEqual([
      'zeta.js',
      'office_thread.js',
    ]);
  });
});
