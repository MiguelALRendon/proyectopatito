import { beforeEach, describe, expect, it, vi } from 'vitest';

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  create: vi.fn((_options: { port: { terminate: () => void } }) => ({
    worker: true,
  })),
  terminate: vi.fn(),
  readFirstChunk: vi.fn(),
  PasswordException: class PasswordException extends Error {},
  RenderingCancelledException: class RenderingCancelledException extends Error {},
  ProtocolRangeTransport: class ProtocolRangeTransport {
    constructor(
      readonly url: string,
      readonly first: unknown,
    ) {}
  },
}));

vi.mock('pdfjs-dist', () => ({
  PDFWorker: { create: pdfjs.create },
  PasswordException: pdfjs.PasswordException,
  RenderingCancelledException: pdfjs.RenderingCancelledException,
  getDocument: pdfjs.getDocument,
}));
vi.mock('pdfjs-dist/build/pdf.worker.mjs?worker', () => ({
  default: class FakeWorker {
    terminate = pdfjs.terminate;
  },
}));
vi.mock('./assets', () => ({ PDF_ASSET_URLS: { cMapUrl: 'cmaps/' } }));
vi.mock('./rangeTransport', () => ({
  readFirstChunk: pdfjs.readFirstChunk,
  ProtocolRangeTransport: pdfjs.ProtocolRangeTransport,
}));

import { PDF_MAX_IMAGE_PIXELS, PDF_RANGE_CHUNK_BYTES } from '../limits';
import { failureOf, openPdf } from './loader';

const URL_OF_PDF = 'http://workspace-file.localhost/wc/a.pdf';
const COMPLETE_READ = {
  isComplete: true,
  total: 3,
  bytes: new Uint8Array([1, 2, 3]),
};
const PARTIAL_READ = {
  isComplete: false,
  total: 9_000_000,
  bytes: new Uint8Array([4, 5]),
};

function fakePage(log: string[]) {
  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 100 * scale,
      height: 200 * scale,
    })),
    render: vi.fn(() => ({
      promise: Promise.resolve().then(() => void log.push('rendered')),
      cancel: vi.fn(),
    })),
    cleanup: vi.fn(async () => void log.push('cleanup')),
  };
}

function fakeDocument(page: ReturnType<typeof fakePage>) {
  return { numPages: 2, getPage: vi.fn(async () => page) };
}

function fakeTask(document: unknown) {
  return {
    promise: Promise.resolve(document),
    destroy: vi.fn(async () => undefined),
  };
}

function canvas() {
  return document.createElement('canvas');
}

beforeEach(() => {
  pdfjs.getDocument.mockReset();
  pdfjs.terminate.mockReset();
  pdfjs.create.mockClear();
  pdfjs.readFirstChunk.mockReset();
  pdfjs.readFirstChunk.mockResolvedValue(COMPLETE_READ);
});

describe('openPdf: liberación del worker', () => {
  it('si getDocument lanza de forma síncrona, el worker se termina', async () => {
    pdfjs.getDocument.mockImplementation(() => {
      throw new Error('opciones inválidas');
    });
    await expect(openPdf(URL_OF_PDF)).rejects.toThrow('opciones inválidas');
    expect(pdfjs.terminate).toHaveBeenCalledTimes(1);
  });

  it('si el documento no abre, destruye la tarea y termina el worker', async () => {
    const task = fakeTask(null);
    task.promise = Promise.reject(new Error('dañado'));
    pdfjs.getDocument.mockReturnValue(task);
    await expect(openPdf(URL_OF_PDF)).rejects.toThrow('dañado');
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(pdfjs.terminate).toHaveBeenCalledTimes(1);
  });

  it('el worker se termina aunque destruir la tarea falle', async () => {
    const task = fakeTask(null);
    task.promise = Promise.reject(new Error('dañado'));
    task.destroy.mockRejectedValue(new Error('destroy'));
    pdfjs.getDocument.mockReturnValue(task);
    await expect(openPdf(URL_OF_PDF)).rejects.toThrow('destroy');
    expect(pdfjs.terminate).toHaveBeenCalledTimes(1);
  });

  it('destroy del manejador libera la tarea y el worker', async () => {
    const task = fakeTask(fakeDocument(fakePage([])));
    pdfjs.getDocument.mockReturnValue(task);
    const handle = await openPdf(URL_OF_PDF);
    expect(pdfjs.terminate).not.toHaveBeenCalled();
    await handle.destroy();
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(pdfjs.terminate).toHaveBeenCalledTimes(1);
  });
});

describe('openPdf: limpieza de páginas', () => {
  it('medir una página la limpia', async () => {
    const page = fakePage([]);
    pdfjs.getDocument.mockReturnValue(fakeTask(fakeDocument(page)));
    const handle = await openPdf(URL_OF_PDF);
    expect(await handle.pageSize(1)).toEqual({ width: 100, height: 200 });
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  it('pintar una página la limpia solo después de terminar de pintar', async () => {
    const log: string[] = [];
    const page = fakePage(log);
    pdfjs.getDocument.mockReturnValue(fakeTask(fakeDocument(page)));
    const handle = await openPdf(URL_OF_PDF);
    await handle.render({ page: 1, scale: 1, canvas: canvas() }).done;
    expect(log).toEqual(['rendered', 'cleanup']);
  });

  it('una pintura que falla también limpia la página', async () => {
    const page = fakePage([]);
    page.render.mockReturnValue({
      promise: Promise.reject(new Error('fallo de pintura')),
      cancel: vi.fn(),
    });
    pdfjs.getDocument.mockReturnValue(fakeTask(fakeDocument(page)));
    const handle = await openPdf(URL_OF_PDF);
    await expect(
      handle.render({ page: 1, scale: 1, canvas: canvas() }).done,
    ).rejects.toThrow('fallo de pintura');
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('failureOf', () => {
  it('una contraseña requerida se distingue como password', () => {
    expect(failureOf(new pdfjs.PasswordException('x'))).toBe('password');
  });

  it.each([
    ['un error genérico', new Error('x')],
    ['una pintura cancelada', new pdfjs.RenderingCancelledException('x')],
    ['null', null],
    ['un texto', 'password'],
  ])('%s es un documento dañado', (_name, error) => {
    expect(failureOf(error)).toBe('damaged');
  });
});

function pendingTask() {
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((_resolve, fail) => (reject = fail));
  const cancel = vi.fn(() =>
    reject(new pdfjs.RenderingCancelledException('cancelado')),
  );
  return { promise, cancel, reject: (error: Error) => reject(error) };
}

async function openWithPendingRender() {
  const page = fakePage([]);
  const task = pendingTask();
  page.render.mockReturnValue(task as never);
  pdfjs.getDocument.mockReturnValue(fakeTask(fakeDocument(page)));
  return { handle: await openPdf(URL_OF_PDF), page, task };
}

describe('openPdf: cancelación de la pintura', () => {
  it('cancelar después de empezar a pintar cancela la tarea y no falla', async () => {
    const { handle, page, task } = await openWithPendingRender();
    const render = handle.render({ page: 1, scale: 1, canvas: canvas() });
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    render.cancel();
    await expect(render.done).resolves.toBeUndefined();
    expect(task.cancel).toHaveBeenCalledTimes(1);
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  it('cancelar antes de que exista la página cancela la tarea en cuanto nace', async () => {
    const { handle, page, task } = await openWithPendingRender();
    const render = handle.render({ page: 1, scale: 1, canvas: canvas() });
    render.cancel();
    expect(task.cancel).not.toHaveBeenCalled();
    await expect(render.done).resolves.toBeUndefined();
    expect(task.cancel).toHaveBeenCalledTimes(1);
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  it('un error que no es de cancelación se relanza aunque se haya cancelado', async () => {
    const { handle, page, task } = await openWithPendingRender();
    task.cancel.mockImplementation(() => task.reject(new Error('otro fallo')));
    const render = handle.render({ page: 1, scale: 1, canvas: canvas() });
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    render.cancel();
    await expect(render.done).rejects.toThrow('otro fallo');
  });

  it('una contraseña requerida durante la pintura no se silencia', async () => {
    const { handle, page, task } = await openWithPendingRender();
    const render = handle.render({ page: 1, scale: 1, canvas: canvas() });
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));
    task.reject(new pdfjs.PasswordException('pide clave'));
    await expect(render.done).rejects.toBeInstanceOf(pdfjs.PasswordException);
  });
});

function openedOptions() {
  return pdfjs.getDocument.mock.calls[0][0] as Record<string, unknown>;
}

describe('openPdf: origen y opciones de getDocument', () => {
  beforeEach(() => {
    pdfjs.getDocument.mockReturnValue(fakeTask(fakeDocument(fakePage([]))));
  });

  it('lee el primer trozo con el tamaño de rango del límite', async () => {
    await openPdf(URL_OF_PDF);
    expect(pdfjs.readFirstChunk).toHaveBeenCalledWith(
      URL_OF_PDF,
      PDF_RANGE_CHUNK_BYTES,
    );
  });

  it('un archivo leído completo se entrega como datos, sin transporte por rangos', async () => {
    await openPdf(URL_OF_PDF);
    expect(openedOptions().data).toBe(COMPLETE_READ.bytes);
    expect(openedOptions()).not.toHaveProperty('range');
  });

  it('un archivo incompleto se entrega con ProtocolRangeTransport y sin datos', async () => {
    pdfjs.readFirstChunk.mockResolvedValue(PARTIAL_READ);
    await openPdf(URL_OF_PDF);
    const { range } = openedOptions();
    expect(range).toBeInstanceOf(pdfjs.ProtocolRangeTransport);
    expect(range).toMatchObject({ url: URL_OF_PDF, first: PARTIAL_READ });
    expect(openedOptions()).not.toHaveProperty('data');
  });

  it('descarga solo lo que se ve: sin autofetch, sin stream y con fetch en el worker', async () => {
    await openPdf(URL_OF_PDF);
    expect(openedOptions()).toMatchObject({
      disableAutoFetch: true,
      disableStream: true,
      useWorkerFetch: true,
    });
  });

  it('acota los rangos y el tamaño de imagen con los límites', async () => {
    await openPdf(URL_OF_PDF);
    expect(openedOptions().rangeChunkSize).toBe(PDF_RANGE_CHUNK_BYTES);
    expect(openedOptions().maxImageSize).toBe(PDF_MAX_IMAGE_PIXELS);
  });

  it('usa el worker propio y las rutas de recursos locales', async () => {
    await openPdf(URL_OF_PDF);
    const [{ port }] = pdfjs.create.mock.calls[0];
    expect(port.terminate).toBe(pdfjs.terminate);
    expect(openedOptions().worker).toEqual({ worker: true });
    expect(openedOptions().cMapUrl).toBe('cmaps/');
  });
});
