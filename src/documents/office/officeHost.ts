import {
  OFFICE_CLOSE_TIMEOUT_MS,
  OFFICE_LOAD_TIMEOUT_MS,
  OFFICE_RELEASED_BYTES,
  OFFICE_RELEASE_POLL_MS,
  OFFICE_RELEASE_TIMEOUT_MS,
  OFFICE_SAVE_TIMEOUT_MS,
} from '../limits';
import {
  OFFICE_INIT_TYPE,
  parseHostMessage,
  type HostMessage,
  type OfficeErrorCode,
  type OfficeFormat,
  type OfficeKind,
  type PageMessage,
} from './officeProtocol';

export const ZETA_ORIGIN = 'http://zeta-assets.localhost';
export const FRAME_TITLE = 'Documento de Office';

export type OfficeFailureCode = OfficeErrorCode | 'timeout' | 'destroyed';

export class OfficeError extends Error {
  constructor(
    readonly code: OfficeFailureCode,
    detail = '',
  ) {
    super(detail || code);
  }
}

export type OfficeEvent = Extract<
  HostMessage,
  { cmd: 'progress' | 'modified' | 'save-requested' | 'saved' | 'blocked' }
>;

export type OfficeListener = (event: OfficeEvent) => void;

export interface FrameHandle {
  loaded: Promise<void>;
  deliver: (port: MessagePort) => void;
  remove: () => void;
}

export interface OfficeEnvironment {
  openFrame: (container: HTMLElement) => FrameHandle;
  memory: () => Promise<number | null>;
  sleep: (ms: number) => Promise<void>;
}

interface Session {
  frame: FrameHandle;
  port: MessagePort;
}

interface Waiter {
  accept: (message: HostMessage) => boolean;
  fail: (error: OfficeError) => void;
}

const EVENT_COMMANDS = new Set<HostMessage['cmd']>([
  'progress',
  'modified',
  'save-requested',
  'blocked',
]);

function isEvent(message: HostMessage): message is OfficeEvent {
  if (message.cmd === 'saved') return !message.requested;
  return EVENT_COMMANDS.has(message.cmd);
}

function failureOf(message: HostMessage, docId?: string): OfficeError | null {
  if (message.cmd !== 'error' || message.docId !== docId) return null;
  return new OfficeError(message.code, message.detail);
}

export class OfficeHost {
  private session: Session | null = null;
  private generation = 0;
  private settling: Promise<void> = Promise.resolve();
  private readonly waiters = new Set<Waiter>();
  private readonly listeners = new Set<OfficeListener>();

  constructor(private readonly env: OfficeEnvironment) {}

  get isMounted(): boolean {
    return this.session !== null;
  }

  subscribe(listener: OfficeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async mount(container: HTMLElement): Promise<number> {
    await this.destroy();
    this.generation += 1;
    const owner = this.generation;
    const channel = new MessageChannel();
    const frame = this.env.openFrame(container);
    const session = { frame, port: channel.port1 };
    this.session = session;
    channel.port1.onmessage = (event) => this.receive(event.data);
    const ready = this.expectReady();
    void frame.loaded.then(() => {
      if (this.session === session) frame.deliver(channel.port2);
    });
    try {
      await ready;
    } catch (error) {
      if (this.session === session) await this.destroy();
      throw error;
    }
    return owner;
  }

  async open(
    docId: string,
    ext: OfficeFormat,
    bytes: ArrayBuffer,
  ): Promise<OfficeKind> {
    const session = this.requireSession();
    const opened = this.wait<OfficeKind>((message) => {
      const failure = failureOf(message, docId);
      if (failure) throw failure;
      const isMine = message.cmd === 'opened' && message.docId === docId;
      return isMine ? message.kind : undefined;
    }, OFFICE_LOAD_TIMEOUT_MS);
    this.send(session, { cmd: 'open', docId, ext, bytes }, [bytes]);
    return opened;
  }

  async save(docId: string): Promise<ArrayBuffer> {
    const session = this.requireSession();
    const saved = this.wait<ArrayBuffer>((message) => {
      const failure = failureOf(message, docId);
      if (failure) throw failure;
      const isMine =
        message.cmd === 'saved' && message.docId === docId && message.requested;
      return isMine ? message.bytes : undefined;
    }, OFFICE_SAVE_TIMEOUT_MS);
    this.send(session, { cmd: 'save', docId });
    return saved;
  }

  async close(docId: string): Promise<void> {
    const session = this.session;
    if (!session) return;
    const closed = this.wait<true>((message) => {
      const isMine = message.cmd === 'closed' && message.docId === docId;
      return isMine ? true : undefined;
    }, OFFICE_CLOSE_TIMEOUT_MS);
    this.send(session, { cmd: 'close', docId });
    await closed.catch(() => undefined);
  }

  async destroyOwned(owner: number): Promise<void> {
    if (owner === this.generation) await this.destroy();
  }

  async destroy(): Promise<void> {
    const session = this.session;
    if (session) {
      this.session = null;
      this.failAll(new OfficeError('destroyed'));
      session.port.close();
      session.frame.remove();
      this.settling = this.waitForRelease();
    }
    await this.settling;
  }

  private expectReady(): Promise<true> {
    return this.wait<true>((message) => {
      if (message.cmd === 'ready') return true;
      const failure = failureOf(message);
      if (failure) throw failure;
      return undefined;
    }, OFFICE_LOAD_TIMEOUT_MS);
  }

  private requireSession(): Session {
    if (!this.session) throw new OfficeError('destroyed');
    return this.session;
  }

  private send(
    session: Session,
    message: PageMessage,
    transfer: Transferable[] = [],
  ): void {
    session.port.postMessage(message, transfer);
  }

  private receive(data: unknown): void {
    const message = parseHostMessage(data);
    if (!message) return;
    if (isEvent(message))
      this.listeners.forEach((listener) => listener(message));
    for (const waiter of [...this.waiters]) {
      if (waiter.accept(message)) this.waiters.delete(waiter);
    }
  }

  private wait<T>(
    accept: (message: HostMessage) => T | undefined,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new OfficeError('timeout'));
      }, timeoutMs);
      const waiter: Waiter = {
        accept: (message) => {
          try {
            const value = accept(message);
            if (value === undefined) return false;
            resolve(value);
          } catch (error) {
            reject(error);
          }
          clearTimeout(timer);
          return true;
        },
        fail: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.waiters.add(waiter);
    });
  }

  private failAll(error: OfficeError): void {
    for (const waiter of this.waiters) waiter.fail(error);
    this.waiters.clear();
  }

  private async waitForRelease(): Promise<void> {
    let waited = 0;
    while (waited < OFFICE_RELEASE_TIMEOUT_MS) {
      const bytes = await this.env.memory();
      if (bytes === null || bytes <= OFFICE_RELEASED_BYTES) return;
      await this.env.sleep(OFFICE_RELEASE_POLL_MS);
      waited += OFFICE_RELEASE_POLL_MS;
    }
  }
}

interface MemoryReport {
  bytes: number;
}

type MeasurablePerformance = Performance & {
  measureUserAgentSpecificMemory?: () => Promise<MemoryReport>;
};

export async function measureWebViewMemory(): Promise<number | null> {
  const measure = (performance as MeasurablePerformance)
    .measureUserAgentSpecificMemory;
  if (!window.crossOriginIsolated || !measure) return null;
  try {
    return (await measure.call(performance)).bytes;
  } catch {
    return null;
  }
}

export function openOfficeFrame(container: HTMLElement): FrameHandle {
  const frame = document.createElement('iframe');
  frame.className = 'office-frame';
  frame.title = FRAME_TITLE;
  frame.setAttribute('allow', 'cross-origin-isolated');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  const loaded = new Promise<void>((resolve) =>
    frame.addEventListener('load', () => resolve(), { once: true }),
  );
  frame.src = `${ZETA_ORIGIN}/host.html`;
  container.appendChild(frame);
  return {
    loaded,
    deliver: (port) =>
      frame.contentWindow?.postMessage(
        { type: OFFICE_INIT_TYPE },
        ZETA_ORIGIN,
        [port],
      ),
    remove: () => frame.remove(),
  };
}

export const officeHost = new OfficeHost({
  openFrame: openOfficeFrame,
  memory: measureWebViewMemory,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
