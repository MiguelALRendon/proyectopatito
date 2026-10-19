const CDP_PORT = 9333;
const OPEN_TIMEOUT_MS = 10_000;

export interface RawSession {
  send: (method: string, params?: object) => Promise<unknown>;
  close: () => void;
}

export async function targets(): Promise<string[]> {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const list = (await response.json()) as { type: string; url: string }[];
  return list.map((target) => `${target.type} ${target.url}`);
}

async function endpointOf(isBrowser: boolean): Promise<string> {
  const base = `http://127.0.0.1:${CDP_PORT}`;
  if (isBrowser) {
    const version = (await (await fetch(`${base}/json/version`)).json()) as {
      webSocketDebuggerUrl: string;
    };
    return version.webSocketDebuggerUrl;
  }
  const list = (await (await fetch(`${base}/json/list`)).json()) as {
    type: string;
    url: string;
    webSocketDebuggerUrl: string;
  }[];
  const page = list.find(
    (target) => target.type === 'page' && target.url.startsWith('http://tauri'),
  );
  if (!page) throw new Error('No hay página de la aplicación');
  return page.webSocketDebuggerUrl;
}

export async function rawSession(isBrowser: boolean): Promise<RawSession> {
  const socket = new WebSocket(await endpointOf(isBrowser));
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('CDP no abrió'));
    setTimeout(() => reject(new Error('CDP tardó en abrir')), OPEN_TIMEOUT_MS);
  });
  let counter = 0;
  const send = (method: string, params: object = {}) =>
    new Promise<unknown>((resolve) => {
      counter += 1;
      const mine = counter;
      const onMessage = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as { id?: number };
        if (message.id !== mine) return;
        socket.removeEventListener('message', onMessage);
        resolve(message);
      };
      socket.addEventListener('message', onMessage);
      socket.send(JSON.stringify({ id: mine, method, params }));
    });
  return { send, close: () => socket.close() };
}

interface TargetInfo {
  id: string;
  type: string;
  url: string;
}

async function appTargetId(): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const list = (await response.json()) as TargetInfo[];
  const page = list.find(
    (target) => target.type === 'page' && target.url.startsWith('http://tauri'),
  );
  if (!page) throw new Error('No hay página de la aplicación');
  return page.id;
}

export async function resizeAppWindow(
  width: number,
  height: number,
): Promise<void> {
  const session = await rawSession(true);
  const found = (await session.send('Browser.getWindowForTarget', {
    targetId: await appTargetId(),
  })) as { result: { windowId: number } };
  await session.send('Browser.setWindowBounds', {
    windowId: found.result.windowId,
    bounds: { width, height },
  });
  session.close();
}
