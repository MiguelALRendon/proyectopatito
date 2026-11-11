import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GATE_SCRIPT,
  type IpcCall,
  type IpcFake,
  type IpcRule,
} from './ipcGate';

const CONFIRM_URL = 'http://ipc.localhost/app_confirm_close';
const CANCEL_URL = 'http://ipc.localhost/app_cancel_close';
const OTHER_URL = 'http://ipc.localhost/fs_probe';
const ERROR_CALLBACK = 77;

interface FakeWindow {
  fetch: (input: string, init?: unknown) => Promise<Response>;
  chrome?: { webview: { postMessage: (message: unknown) => void } };
  __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
  __ipcGate: {
    rules: Record<string, IpcRule>;
    fakes: Record<string, IpcFake>;
    calls: IpcCall[];
    isPostMessageWrapped: boolean;
  };
}

const nativeFetch = vi.fn();
const nativePost = vi.fn();
const runCallback = vi.fn();
let fakeWindow: FakeWindow;

function loadGate(withWebview = true): FakeWindow {
  const win = {
    fetch: nativeFetch,
    chrome: withWebview ? { webview: { postMessage: nativePost } } : undefined,
    __TAURI_INTERNALS__: { runCallback },
  } as unknown as FakeWindow;
  runInNewContext(readFileSync(GATE_SCRIPT, 'utf8'), {
    window: win,
    Response,
    setTimeout: (callback: () => void) => callback(),
  });
  return win;
}

function ipcMessage(cmd: string, payload: unknown = {}): string {
  return JSON.stringify({
    cmd,
    callback: 1,
    error: ERROR_CALLBACK,
    payload,
  });
}

const CLOUD_BODY = { kind: 'cloud', len: 7 };
const CLOUD_FAKE: IpcFake = {
  body: CLOUD_BODY,
  pathSuffix: 'nube.txt',
  args: { allow_download: false },
};
const CLOUD_ARGS = { path: 'wc/nube.txt', allow_download: false };

function probeRequest(
  args: unknown,
): [string, { method: string; body: string }] {
  return [OTHER_URL, { method: 'POST', body: JSON.stringify(args) }];
}

beforeEach(() => {
  nativeFetch.mockReset().mockResolvedValue(new Response('ok'));
  nativePost.mockReset();
  runCallback.mockReset();
  fakeWindow = loadGate();
});

describe('envoltorio de IPC: fetch', () => {
  it('deja pasar sin tocar un comando que no gestiona', async () => {
    await fakeWindow.fetch(OTHER_URL, { method: 'POST' });
    expect(nativeFetch).toHaveBeenCalledWith(OTHER_URL, { method: 'POST' });
    expect(fakeWindow.__ipcGate.calls).toEqual([]);
  });

  it('deja pasar un comando gestionado en modo pass y lo registra', async () => {
    await fakeWindow.fetch(CONFIRM_URL, { method: 'POST' });
    expect(nativeFetch).toHaveBeenCalledWith(CONFIRM_URL, { method: 'POST' });
    expect(fakeWindow.__ipcGate.calls).toEqual([
      { command: 'app_confirm_close', transport: 'fetch', rule: 'pass' },
    ]);
  });

  it('traga la confirmación sin llegar a la red y responde sin Tauri-Response', async () => {
    fakeWindow.__ipcGate.rules.app_confirm_close = 'swallow';
    const response = await fakeWindow.fetch(CONFIRM_URL, { method: 'POST' });
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(response.headers.get('Tauri-Response')).toBeNull();
    expect(await response.json()).toBeNull();
  });

  it('redirige la confirmación a la cancelación conservando la petición', async () => {
    fakeWindow.__ipcGate.rules.app_confirm_close = 'cancel';
    const init = { method: 'POST', body: '{}' };
    await fakeWindow.fetch(CONFIRM_URL, init);
    expect(nativeFetch).toHaveBeenCalledWith(CANCEL_URL, init);
  });
});

describe('envoltorio de IPC: postMessage', () => {
  it('se aplica sobre el objeto del webview', () => {
    expect(fakeWindow.__ipcGate.isPostMessageWrapped).toBe(true);
    expect(fakeWindow.chrome?.webview.postMessage).not.toBe(nativePost);
  });

  it('informa de que no pudo envolverlo si no hay webview', () => {
    expect(loadGate(false).__ipcGate.isPostMessageWrapped).toBe(false);
  });

  it('deja pasar tal cual los mensajes ajenos y los no JSON', () => {
    const message = ipcMessage('fs_probe');
    fakeWindow.chrome?.webview.postMessage(message);
    fakeWindow.chrome?.webview.postMessage('no es json');
    fakeWindow.chrome?.webview.postMessage(new Uint8Array(2));
    expect(nativePost).toHaveBeenCalledTimes(3);
    expect(nativePost).toHaveBeenNthCalledWith(1, message);
    expect(fakeWindow.__ipcGate.calls).toEqual([]);
  });

  it('traga la confirmación y rechaza su promesa con la devolución de error', () => {
    fakeWindow.__ipcGate.rules.app_confirm_close = 'swallow';
    fakeWindow.chrome?.webview.postMessage(ipcMessage('app_confirm_close'));
    expect(nativePost).not.toHaveBeenCalled();
    expect(runCallback).toHaveBeenCalledWith(ERROR_CALLBACK, null);
    expect(fakeWindow.__ipcGate.calls[0]).toMatchObject({
      transport: 'postMessage',
      rule: 'swallow',
    });
  });

  it('redirige la confirmación a la cancelación', () => {
    fakeWindow.__ipcGate.rules.app_confirm_close = 'cancel';
    fakeWindow.chrome?.webview.postMessage(ipcMessage('app_confirm_close'));
    const forwarded = JSON.parse(nativePost.mock.calls[0][0] as string);
    expect(forwarded).toMatchObject({
      cmd: 'app_cancel_close',
      callback: 1,
      error: ERROR_CALLBACK,
    });
  });

  it('en modo pass reenvía el mensaje original sin reserializar', () => {
    const message = ipcMessage('app_confirm_close');
    fakeWindow.chrome?.webview.postMessage(message);
    expect(nativePost).toHaveBeenCalledWith(message);
  });
});

describe('envoltorio de IPC: respuestas simuladas', () => {
  beforeEach(() => {
    fakeWindow.__ipcGate.fakes.fs_probe = CLOUD_FAKE;
  });

  it('por fetch responde la simulación con Tauri-Response ok sin llegar a la red', async () => {
    const response = await fakeWindow.fetch(...probeRequest(CLOUD_ARGS));
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(response.headers.get('Tauri-Response')).toBe('ok');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual(CLOUD_BODY);
    expect(fakeWindow.__ipcGate.calls).toEqual([
      { command: 'fs_probe', transport: 'fetch', rule: 'fake' },
    ]);
  });

  it('por fetch deja pasar otra ruta, otros argumentos o un cuerpo que no es JSON', async () => {
    await fakeWindow.fetch(
      ...probeRequest({ ...CLOUD_ARGS, path: 'otro.txt' }),
    );
    await fakeWindow.fetch(
      ...probeRequest({ ...CLOUD_ARGS, allow_download: true }),
    );
    await fakeWindow.fetch(OTHER_URL, {
      method: 'POST',
      body: new Uint8Array(1),
    });
    await fakeWindow.fetch(OTHER_URL);
    expect(nativeFetch).toHaveBeenCalledTimes(4);
    expect(fakeWindow.__ipcGate.calls).toEqual([]);
  });

  it('por postMessage entrega la simulación al éxito de la promesa sin llegar a Rust', () => {
    fakeWindow.chrome?.webview.postMessage(ipcMessage('fs_probe', CLOUD_ARGS));
    expect(nativePost).not.toHaveBeenCalled();
    expect(runCallback).toHaveBeenCalledWith(1, CLOUD_BODY);
    expect(fakeWindow.__ipcGate.calls).toEqual([
      { command: 'fs_probe', transport: 'postMessage', rule: 'fake' },
    ]);
  });

  it('por postMessage deja pasar lo que no coincide', () => {
    const message = ipcMessage('fs_probe', {
      ...CLOUD_ARGS,
      allow_download: true,
    });
    fakeWindow.chrome?.webview.postMessage(message);
    expect(nativePost).toHaveBeenCalledWith(message);
    expect(runCallback).not.toHaveBeenCalled();
  });

  it('quitar la simulación devuelve el comando a la red', async () => {
    delete fakeWindow.__ipcGate.fakes.fs_probe;
    await fakeWindow.fetch(...probeRequest(CLOUD_ARGS));
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it('una simulación sin filtros responde a toda llamada del comando', async () => {
    fakeWindow.__ipcGate.fakes.fs_probe = { body: 1 };
    expect(await (await fakeWindow.fetch(OTHER_URL)).json()).toBe(1);
  });
});
