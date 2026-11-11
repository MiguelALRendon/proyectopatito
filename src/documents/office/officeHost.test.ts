import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FRAME_TITLE,
  OfficeError,
  OfficeHost,
  ZETA_ORIGIN,
  measureWebViewMemory,
  openOfficeFrame,
  type FrameHandle,
  type OfficeEnvironment,
  type OfficeEvent,
} from './officeHost';
import { OFFICE_INIT_TYPE } from './officeProtocol';
import {
  OFFICE_SAVE_TIMEOUT_MS,
  OFFICE_LOAD_TIMEOUT_MS,
  OFFICE_RELEASED_BYTES,
  OFFICE_RELEASE_TIMEOUT_MS,
  OFFICE_RELEASE_POLL_MS,
} from '../limits';

interface FakeFrame extends FrameHandle {
  port: MessagePort | null;
  load: () => void;
  received: unknown[];
  say: (message: unknown) => void;
}

let frames: FakeFrame[];
let memoryReadings: (number | null)[];
let sleeps: number[];
let ports: MessagePort[];
let host: OfficeHost;

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeFrame(): FakeFrame {
  let resolveLoaded: () => void = () => undefined;
  const frame: FakeFrame = {
    port: null,
    received: [],
    loaded: new Promise<void>((resolve) => (resolveLoaded = resolve)),
    load: () => resolveLoaded(),
    deliver: vi.fn((port: MessagePort) => {
      frame.port = port;
      ports.push(port);
      port.onmessage = (event) => frame.received.push(event.data);
    }),
    remove: vi.fn(),
    say: (message) => frame.port?.postMessage(message),
  };
  return frame;
}

function makeEnvironment(): OfficeEnvironment {
  return {
    openFrame: vi.fn(() => {
      const frame = makeFrame();
      frames.push(frame);
      return frame;
    }),
    memory: vi.fn(async () => memoryReadings.shift() ?? null),
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
    }),
  };
}

async function startMount() {
  const mounting = host.mount(document.body);
  await tick();
  return { mounting, frame: frames[frames.length - 1] };
}

async function mountReady(): Promise<FakeFrame> {
  const { mounting, frame } = await startMount();
  frame.load();
  await tick();
  frame.say({ cmd: 'ready' });
  await mounting;
  return frame;
}

beforeEach(() => {
  frames = [];
  ports = [];
  sleeps = [];
  memoryReadings = [];
  host = new OfficeHost(makeEnvironment());
});

afterEach(() => {
  vi.useRealTimers();
  ports.forEach((port) => port.close());
});

describe('OfficeHost.mount', () => {
  it('crea el iframe, le entrega el puerto al cargar y espera el ready', async () => {
    const { mounting, frame } = await startMount();
    expect(frame.deliver).not.toHaveBeenCalled();
    frame.load();
    await tick();
    expect(frame.deliver).toHaveBeenCalledTimes(1);
    frame.say({ cmd: 'ready' });
    await expect(mounting).resolves.toBe(1);
    expect(host.isMounted).toBe(true);
  });

  it('falla con boot-failed si el iframe no pudo iniciar ZetaOffice', async () => {
    const { mounting } = await startMount();
    frames[0].load();
    await tick();
    frames[0].say({ cmd: 'error', code: 'boot-failed', detail: 'wasm' });
    await expect(mounting).rejects.toMatchObject({ code: 'boot-failed' });
  });

  it('si el arranque falla, el iframe se quita y no queda sesión', async () => {
    const { mounting } = await startMount();
    frames[0].load();
    await tick();
    frames[0].say({ cmd: 'error', code: 'boot-failed', detail: 'wasm' });
    await expect(mounting).rejects.toMatchObject({ code: 'boot-failed' });
    expect(frames[0].remove).toHaveBeenCalledTimes(1);
    expect(host.isMounted).toBe(false);
  });

  it('falla por tiempo si el ready no llega en OFFICE_LOAD_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    const mounting = host.mount(document.body);
    const assertion = expect(mounting).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(OFFICE_LOAD_TIMEOUT_MS);
    await assertion;
  });

  it('no entrega el puerto si el iframe se destruyó antes de cargar', async () => {
    const { mounting } = await startMount();
    const assertion = expect(mounting).rejects.toMatchObject({
      code: 'destroyed',
    });
    await host.destroy();
    frames[0].load();
    await tick();
    expect(frames[0].deliver).not.toHaveBeenCalled();
    await assertion;
  });

  it('un segundo mount destruye el iframe anterior antes de crear otro', async () => {
    const first = await mountReady();
    const mounting = host.mount(document.body);
    await tick();
    expect(first.remove).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(2);
    frames[1].load();
    await tick();
    frames[1].say({ cmd: 'ready' });
    await mounting;
  });

  it('ignora mensajes inválidos del iframe', async () => {
    const { mounting } = await startMount();
    frames[0].load();
    await tick();
    let isSettled = false;
    mounting.then(
      () => (isSettled = true),
      () => (isSettled = true),
    );
    frames[0].say({ cmd: 'constructor' });
    frames[0].say(null);
    frames[0].say('basura');
    frames[0].say({ cmd: 'opened', docId: 7, kind: 'writer' });
    await tick();
    expect(isSettled).toBe(false);
    frames[0].say({ cmd: 'ready' });
    await expect(mounting).resolves.toBe(1);
    expect(host.isMounted).toBe(true);
  });
});

describe('OfficeHost.open', () => {
  it('manda los bytes como transferibles y resuelve con el tipo de documento', async () => {
    const frame = await mountReady();
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const opening = host.open('doc-1', 'docx', bytes);
    await vi.waitFor(() => expect(frame.received).toHaveLength(1));
    expect(bytes.byteLength).toBe(0);
    const sent = frame.received[0] as {
      cmd: string;
      docId: string;
      ext: string;
      bytes: ArrayBuffer;
    };
    expect(sent.cmd).toBe('open');
    expect(sent.docId).toBe('doc-1');
    expect(sent.ext).toBe('docx');
    expect(new Uint8Array(sent.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    frame.say({ cmd: 'opened', docId: 'doc-1', kind: 'writer' });
    await expect(opening).resolves.toBe('writer');
  });

  it('falla con open-failed si el error es de ese documento', async () => {
    const frame = await mountReady();
    const opening = host.open('doc-1', 'xlsx', new ArrayBuffer(4));
    await tick();
    frame.say({
      cmd: 'error',
      code: 'open-failed',
      detail: 'corrupto',
      docId: 'doc-1',
    });
    await expect(opening).rejects.toMatchObject({
      code: 'open-failed',
      message: 'corrupto',
    });
  });

  it('ignora el opened y los errores de otro documento', async () => {
    const frame = await mountReady();
    const opening = host.open('doc-1', 'odt', new ArrayBuffer(4));
    await tick();
    frame.say({ cmd: 'opened', docId: 'otro', kind: 'calc' });
    frame.say({ cmd: 'error', code: 'busy', detail: '', docId: 'otro' });
    frame.say({ cmd: 'error', code: 'boot-failed', detail: '' });
    frame.say({ cmd: 'opened', docId: 'doc-1', kind: 'impress' });
    await expect(opening).resolves.toBe('impress');
  });

  it('falla por tiempo si nunca llega el opened', async () => {
    const frame = await mountReady();
    expect(frame.port).not.toBeNull();
    vi.useFakeTimers();
    const opening = host.open('doc-1', 'pptx', new ArrayBuffer(4));
    const assertion = expect(opening).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(OFFICE_LOAD_TIMEOUT_MS);
    await assertion;
  });

  it('sin iframe montado falla con destroyed', async () => {
    await expect(
      host.open('a', 'doc', new ArrayBuffer(1)),
    ).rejects.toBeInstanceOf(OfficeError);
    await expect(
      host.open('a', 'doc', new ArrayBuffer(1)),
    ).rejects.toMatchObject({
      code: 'destroyed',
    });
  });
});

describe('OfficeHost.close', () => {
  it('manda close y espera el closed del mismo documento', async () => {
    const frame = await mountReady();
    let finished = false;
    const closing = host.close('doc-1').then(() => (finished = true));
    await vi.waitFor(() =>
      expect(frame.received).toEqual([{ cmd: 'close', docId: 'doc-1' }]),
    );
    frame.say({ cmd: 'closed', docId: 'otro' });
    await tick();
    expect(finished).toBe(false);
    frame.say({ cmd: 'closed', docId: 'doc-1' });
    await closing;
    expect(finished).toBe(true);
  });

  it('termina igual si el closed nunca llega', async () => {
    await mountReady();
    vi.useFakeTimers();
    const closing = host.close('doc-1');
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(closing).resolves.toBeUndefined();
  });

  it('sin iframe no hace nada', async () => {
    await expect(host.close('a')).resolves.toBeUndefined();
  });
});

describe('OfficeHost.subscribe', () => {
  it('entrega progreso, cambios, guardados pedidos y comandos vetados', async () => {
    const frame = await mountReady();
    const seen: OfficeEvent[] = [];
    host.subscribe((event) => seen.push(event));
    frame.say({ cmd: 'progress', loaded: 1, total: 2 });
    frame.say({ cmd: 'modified', docId: 'a' });
    frame.say({ cmd: 'save-requested', docId: 'a' });
    frame.say({ cmd: 'blocked', command: '.uno:SaveAs' });
    frame.say({ cmd: 'closed', docId: 'a' });
    await tick();
    expect(seen.map((event) => event.cmd)).toEqual([
      'progress',
      'modified',
      'save-requested',
      'blocked',
    ]);
  });

  it('deja de entregar tras darse de baja', async () => {
    const frame = await mountReady();
    const listener = vi.fn();
    const unsubscribe = host.subscribe(listener);
    frame.say({ cmd: 'modified', docId: 'a' });
    await tick();
    unsubscribe();
    frame.say({ cmd: 'modified', docId: 'a' });
    await tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('OfficeHost.destroy', () => {
  it('quita el iframe, cierra el puerto y rechaza lo pendiente', async () => {
    const frame = await mountReady();
    const opening = host.open('doc-1', 'doc', new ArrayBuffer(1));
    const assertion = expect(opening).rejects.toMatchObject({
      code: 'destroyed',
    });
    await host.destroy();
    expect(frame.remove).toHaveBeenCalledTimes(1);
    expect(host.isMounted).toBe(false);
    await assertion;
  });

  it('esperar la liberación de memoria hasta bajar del umbral', async () => {
    await mountReady();
    const high = OFFICE_RELEASED_BYTES * 2;
    memoryReadings = [high, high, OFFICE_RELEASED_BYTES];
    await host.destroy();
    expect(sleeps).toEqual([OFFICE_RELEASE_POLL_MS, OFFICE_RELEASE_POLL_MS]);
  });

  it('no espera si el WebView no sabe medir la memoria', async () => {
    await mountReady();
    memoryReadings = [null];
    await host.destroy();
    expect(sleeps).toEqual([]);
  });

  it('se rinde tras OFFICE_RELEASE_TIMEOUT_MS si la memoria no baja', async () => {
    await mountReady();
    memoryReadings = Array(1000).fill(OFFICE_RELEASED_BYTES * 3);
    await host.destroy();
    expect(sleeps).toHaveLength(
      OFFICE_RELEASE_TIMEOUT_MS / OFFICE_RELEASE_POLL_MS,
    );
  });

  it('un mount posterior espera a que termine la liberación', async () => {
    await mountReady();
    let release: () => void = () => undefined;
    const env = (host as unknown as { env: OfficeEnvironment }).env;
    env.sleep = () => new Promise<void>((resolve) => (release = resolve));
    memoryReadings = [OFFICE_RELEASED_BYTES * 2, null];
    const destroying = host.destroy();
    const mounting = host.mount(document.body);
    await tick();
    expect(frames).toHaveLength(1);
    release();
    await destroying;
    await tick();
    expect(frames).toHaveLength(2);
    frames[1].load();
    await tick();
    frames[1].say({ cmd: 'ready' });
    await mounting;
  });

  it('es idempotente', async () => {
    const frame = await mountReady();
    await host.destroy();
    await host.destroy();
    expect(frame.remove).toHaveBeenCalledTimes(1);
  });
});

it('el mensaje de arranque lleva el tipo que reconoce host.js', () => {
  const hostScript = readFileSync('src-tauri/assets/zeta/host.js', 'utf-8');
  expect(OFFICE_INIT_TYPE).toBe('dakedaduck-office-init');
  expect(hostScript).toContain(`const INIT_TYPE = '${OFFICE_INIT_TYPE}';`);
});

describe('openOfficeFrame: el iframe real', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('se crea dentro del contenedor con sandbox mínimo, aislamiento y origen de zeta-assets', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    openOfficeFrame(container);
    const frame = container.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.parentElement).toBe(container);
    expect(frame.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin',
    );
    expect(frame.getAttribute('allow')).toBe('cross-origin-isolated');
    expect(frame.title).toBe(FRAME_TITLE);
    expect(frame.className).toBe('office-frame');
    expect(frame.getAttribute('src')).toBe(`${ZETA_ORIGIN}/host.html`);
  });

  it('loaded se cumple con el evento load y deliver fija el origen de destino', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = openOfficeFrame(container);
    const frame = container.querySelector('iframe') as HTMLIFrameElement;
    const post = vi.fn();
    Object.defineProperty(frame, 'contentWindow', {
      value: { postMessage: post },
    });
    frame.dispatchEvent(new Event('load'));
    await expect(handle.loaded).resolves.toBeUndefined();
    const port = new MessageChannel().port2;
    handle.deliver(port);
    expect(post).toHaveBeenCalledWith({ type: OFFICE_INIT_TYPE }, ZETA_ORIGIN, [
      port,
    ]);
    port.close();
  });

  it('remove quita el iframe del contenedor', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = openOfficeFrame(container);
    handle.remove();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('deliver sin ventana de contenido no lanza', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = openOfficeFrame(container);
    const frame = container.querySelector('iframe') as HTMLIFrameElement;
    Object.defineProperty(frame, 'contentWindow', { value: null });
    const port = new MessageChannel().port2;
    expect(() => handle.deliver(port)).not.toThrow();
    port.close();
  });
});

describe('measureWebViewMemory', () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    'crossOriginIsolated',
  );

  afterEach(() => {
    if (original)
      Object.defineProperty(globalThis, 'crossOriginIsolated', original);
    else Reflect.deleteProperty(globalThis, 'crossOriginIsolated');
    Reflect.deleteProperty(performance, 'measureUserAgentSpecificMemory');
  });

  function isolate(isolated: boolean) {
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: isolated,
      configurable: true,
    });
  }

  it('devuelve null si la página no está aislada', async () => {
    isolate(false);
    Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
      value: vi.fn(async () => ({ bytes: 5 })),
      configurable: true,
    });
    await expect(measureWebViewMemory()).resolves.toBeNull();
  });

  it('devuelve null si el WebView no ofrece la medición', async () => {
    isolate(true);
    await expect(measureWebViewMemory()).resolves.toBeNull();
  });

  it('devuelve los bytes medidos cuando todo está disponible', async () => {
    isolate(true);
    Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
      value: vi.fn(async () => ({ bytes: 1234 })),
      configurable: true,
    });
    await expect(measureWebViewMemory()).resolves.toBe(1234);
  });

  it('devuelve null si la medición falla', async () => {
    isolate(true);
    Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
      value: vi.fn(async () => {
        throw new Error('SecurityError');
      }),
      configurable: true,
    });
    await expect(measureWebViewMemory()).resolves.toBeNull();
  });
});

describe('OfficeHost.mount: generaciones y propiedad del iframe', () => {
  it('cada montaje devuelve una generación nueva', async () => {
    await mountReady();
    const second = host.mount(document.body);
    await tick();
    frames[1].load();
    await tick();
    frames[1].say({ cmd: 'ready' });
    await expect(second).resolves.toBe(2);
  });

  it('destroyOwned solo destruye si la generación sigue siendo la vigente', async () => {
    const frame = await mountReady();
    await host.destroyOwned(99);
    expect(frame.remove).not.toHaveBeenCalled();
    expect(host.isMounted).toBe(true);
    await host.destroyOwned(1);
    expect(frame.remove).toHaveBeenCalledTimes(1);
    expect(host.isMounted).toBe(false);
  });

  it('una generación vieja no destruye el iframe del montaje posterior', async () => {
    await mountReady();
    const second = host.mount(document.body);
    await tick();
    frames[1].load();
    await tick();
    frames[1].say({ cmd: 'ready' });
    await second;
    await host.destroyOwned(1);
    expect(frames[1].remove).not.toHaveBeenCalled();
    expect(host.isMounted).toBe(true);
  });
});

describe('OfficeHost.save', () => {
  it('manda save y resuelve con los bytes del guardado pedido', async () => {
    const frame = await mountReady();
    const saving = host.save('doc-1');
    await vi.waitFor(() =>
      expect(frame.received).toEqual([{ cmd: 'save', docId: 'doc-1' }]),
    );
    frame.say({
      cmd: 'saved',
      docId: 'doc-1',
      requested: true,
      bytes: new Uint8Array([9, 8, 7]).buffer,
    });
    const bytes = await saving;
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('ignora guardados de otro documento y los no solicitados', async () => {
    const frame = await mountReady();
    const saving = host.save('doc-1');
    await tick();
    frame.say({
      cmd: 'saved',
      docId: 'otro',
      requested: true,
      bytes: new ArrayBuffer(1),
    });
    frame.say({
      cmd: 'saved',
      docId: 'doc-1',
      requested: false,
      bytes: new ArrayBuffer(1),
    });
    frame.say({
      cmd: 'saved',
      docId: 'doc-1',
      requested: true,
      bytes: new Uint8Array([5]).buffer,
    });
    expect(new Uint8Array(await saving)).toEqual(new Uint8Array([5]));
  });

  it('falla con save-failed si el error es de ese documento', async () => {
    const frame = await mountReady();
    const saving = host.save('doc-1');
    await tick();
    frame.say({
      cmd: 'error',
      code: 'save-failed',
      detail: 'disco virtual lleno',
      docId: 'doc-1',
    });
    await expect(saving).rejects.toMatchObject({ code: 'save-failed' });
  });

  it('falla por tiempo si el iframe nunca contesta', async () => {
    await mountReady();
    vi.useFakeTimers();
    const saving = host.save('doc-1');
    const assertion = expect(saving).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(OFFICE_SAVE_TIMEOUT_MS);
    await assertion;
  });

  it('sin iframe montado falla con destroyed', async () => {
    await expect(host.save('a')).rejects.toMatchObject({ code: 'destroyed' });
  });

  it('un guardado no solicitado llega a los suscriptores con sus bytes y el solicitado no', async () => {
    const frame = await mountReady();
    const seen: string[] = [];
    host.subscribe((event) => seen.push(`${event.cmd}`));
    frame.say({
      cmd: 'saved',
      docId: 'doc-1',
      requested: false,
      bytes: new ArrayBuffer(2),
    });
    frame.say({
      cmd: 'saved',
      docId: 'doc-1',
      requested: true,
      bytes: new ArrayBuffer(2),
    });
    await tick();
    expect(seen).toEqual(['saved']);
  });
});
