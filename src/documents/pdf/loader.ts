import {
  PDFWorker,
  PasswordException,
  RenderingCancelledException,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist';
import PdfWorkerThread from 'pdfjs-dist/build/pdf.worker.mjs?worker';
import { PDF_MAX_IMAGE_PIXELS, PDF_RANGE_CHUNK_BYTES } from '../limits';
import { safeRenderScale, type PageSize } from '../pdfView';
import { PDF_ASSET_URLS } from './assets';
import {
  ProtocolRangeTransport,
  readFirstChunk,
  type FirstRead,
} from './rangeTransport';

export interface RenderRequest {
  page: number;
  scale: number;
  canvas: HTMLCanvasElement;
}

export interface PdfRender {
  done: Promise<void>;
  cancel: () => void;
}

export interface PdfHandle {
  pageCount: number;
  pageSize: (page: number) => Promise<PageSize>;
  render: (request: RenderRequest) => PdfRender;
  destroy: () => Promise<void>;
}

export type PdfFailure = 'password' | 'damaged';

export function failureOf(error: unknown): PdfFailure {
  return error instanceof PasswordException ? 'password' : 'damaged';
}

interface DrawnPage {
  page: PDFPageProxy;
  task: RenderTask;
}

function describeSize(page: PDFPageProxy) {
  const { width, height } = page.getViewport({ scale: 1 });
  return { width, height };
}

async function measure(document: PDFDocumentProxy, pageNumber: number) {
  const page = await document.getPage(pageNumber);
  const size = describeSize(page);
  await page.cleanup();
  return size;
}

async function settle({ page, task }: DrawnPage) {
  try {
    await task.promise;
  } finally {
    await page.cleanup();
  }
}

async function drawPage(
  document: PDFDocumentProxy,
  request: RenderRequest,
): Promise<DrawnPage> {
  const page = await document.getPage(request.page);
  const ratio = window.devicePixelRatio || 1;
  const size = describeSize(page);
  const scale = safeRenderScale(request.scale * ratio, size);
  const viewport = page.getViewport({ scale });
  const { canvas } = request;
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.inlineSize = `${viewport.width / ratio}px`;
  canvas.style.blockSize = `${viewport.height / ratio}px`;
  return { page, task: page.render({ canvas, viewport }) };
}

function startRender(document: PDFDocumentProxy, request: RenderRequest) {
  let current: { cancel: () => void } | null = null;
  let isCancelled = false;
  const done = drawPage(document, request).then(async (drawn) => {
    current = drawn.task;
    if (isCancelled) drawn.task.cancel();
    await settle(drawn);
  });
  const settled = done.catch((error: unknown) => {
    if (!(error instanceof RenderingCancelledException)) throw error;
  });
  return {
    done: settled,
    cancel: () => {
      isCancelled = true;
      current?.cancel();
    },
  };
}

function describeHandle(
  document: PDFDocumentProxy,
  release: () => Promise<void>,
): PdfHandle {
  return {
    pageCount: document.numPages,
    pageSize: (page) => measure(document, page),
    render: (request) => startRender(document, request),
    destroy: release,
  };
}

function sourceFor(url: string, first: FirstRead) {
  if (first.isComplete) return { data: first.bytes };
  return { range: new ProtocolRangeTransport(url, first) };
}

function documentOptions(url: string, first: FirstRead, thread: Worker) {
  return {
    ...sourceFor(url, first),
    worker: PDFWorker.create({ port: thread }),
    ...PDF_ASSET_URLS,
    rangeChunkSize: PDF_RANGE_CHUNK_BYTES,
    maxImageSize: PDF_MAX_IMAGE_PIXELS,
    disableAutoFetch: true,
    disableStream: true,
    useWorkerFetch: true,
  };
}

async function destroyAndTerminate(
  task: PDFDocumentLoadingTask | undefined,
  thread: Worker,
) {
  try {
    await task?.destroy();
  } finally {
    thread.terminate();
  }
}

export async function openPdf(url: string): Promise<PdfHandle> {
  const first = await readFirstChunk(url, PDF_RANGE_CHUNK_BYTES);
  const thread = new PdfWorkerThread();
  let task: PDFDocumentLoadingTask | undefined;
  const release = () => destroyAndTerminate(task, thread);
  try {
    task = getDocument(documentOptions(url, first, thread));
    return describeHandle(await task.promise, release);
  } catch (error) {
    await release();
    throw error;
  }
}
