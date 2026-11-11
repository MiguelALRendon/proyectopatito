import { dirname, relative } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileUrl, WORKSPACE_FILE_ORIGIN } from '../../../src/services/filesApi';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import { launchApp, type AppSession } from './harness';

const APP_ORIGIN = 'http://tauri.localhost';
const PANEL = '[aria-label="Explorador de archivos"]';
const VISIBLE_TIMEOUT_MS = 30_000;
const PREVIEW_SIZE_PX = 160;
const SPECIAL_NAME = 'a#b%c d ñ.txt';
const SPECIAL_CONTENT = 'nombre con caracteres especiales\n';
const SVG_NAME = 'vector-con-script.svg';

interface Reply {
  status: number;
  contentRange: string | null;
  contentLength: string | null;
  contentType: string | null;
  text: string;
}

interface Loaded {
  naturalWidth: number;
  currentSrc: string;
}

let session: AppSession;
let manifest: FixtureManifest;
let seedRoot: string;
let wcDir: string;
const responseHeaders = new Map<string, Record<string, string>>();

function inWorkspace(name: string): string {
  return `${wcDir}/${name}`;
}

function fetchReply(page: Page, url: string, range?: string): Promise<Reply> {
  return page.evaluate(
    async ({ target, rangeHeader }) => {
      const init = rangeHeader ? { headers: { Range: rangeHeader } } : {};
      const response = await fetch(target, init);
      return {
        status: response.status,
        contentRange: response.headers.get('content-range'),
        contentLength: response.headers.get('content-length'),
        contentType: response.headers.get('content-type'),
        text: await response.text(),
      };
    },
    { target: url, rangeHeader: range },
  );
}

function showImage(page: Page, url: string): Promise<Loaded> {
  return page.evaluate(
    ({ target, size }) =>
      new Promise<Loaded>((resolve, reject) => {
        const image = document.createElement('img');
        image.style.cssText = `position:fixed;top:16px;right:16px;width:${size}px;height:${size}px;image-rendering:pixelated;border:2px solid #333;background:#fff`;
        image.onload = () =>
          resolve({
            naturalWidth: image.naturalWidth,
            currentSrc: image.currentSrc,
          });
        image.onerror = () => reject(new Error(`no cargo ${target}`));
        image.src = target;
        document.body.appendChild(image);
      }),
    { target: url, size: PREVIEW_SIZE_PX },
  );
}

function recordResponses(page: Page): void {
  page.on('response', (response) => {
    if (!response.url().startsWith(WORKSPACE_FILE_ORIGIN)) return;
    response
      .allHeaders()
      .then((headers) => responseHeaders.set(response.url(), headers))
      .catch(() => undefined);
  });
}

async function startSession(): Promise<AppSession> {
  const app = await launchApp({ configDir: dirname(manifest.config_path) });
  recordResponses(app.page);
  await app.page.locator(PANEL).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  return app;
}

beforeAll(async () => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
  wcDir = relative(manifest.workspace_root, manifest.wc_path).replaceAll(
    '\\',
    '/',
  );
  session = await startSession();
});

afterAll(() => {
  session?.stop();
  stopFixtures(seedRoot);
});

describe('protocolo workspace-file en la ventana real', () => {
  it('la pagina vive en tauri.localhost y la imagen del fixture carga por el protocolo', async () => {
    const url = fileUrl(inWorkspace('imagen.png'));
    const loaded = await showImage(session.page, url);

    await session.capture('i4-imagen-por-protocolo');
    expect(new URL(session.page.url()).origin).toBe(APP_ORIGIN);
    expect(loaded.naturalWidth).toBeGreaterThan(0);
    expect(loaded.currentSrc).toBe(url);
    expect(new URL(loaded.currentSrc).origin).toBe(WORKSPACE_FILE_ORIGIN);
  });

  it('un Range de inicio y fin responde 206 con Content-Range correcto', async () => {
    const url = fileUrl(inWorkspace('texto-plano.txt'));
    const whole = await fetchReply(session.page, url);
    const total = Number(whole.contentLength);

    const part = await fetchReply(session.page, url, 'bytes=0-9');

    expect(whole.status).toBe(200);
    expect(part.status).toBe(206);
    expect(part.contentRange).toBe(`bytes 0-9/${total}`);
    expect(part.text).toBe(whole.text.slice(0, 10));
  });

  it('un Range sufijo pasa el preflight y devuelve el final del archivo', async () => {
    const url = fileUrl(inWorkspace('texto-plano.txt'));
    const whole = await fetchReply(session.page, url);
    const total = Number(whole.contentLength);

    const tail = await fetchReply(session.page, url, 'bytes=-5');

    expect(tail.status).toBe(206);
    expect(tail.contentRange).toBe(`bytes ${total - 5}-${total - 1}/${total}`);
    expect(tail.text).toBe(whole.text.slice(-5));
  });

  it('una cabecera no permitida falla en el preflight y no llega a pedir el archivo', async () => {
    const url = fileUrl(inWorkspace('texto-plano.txt'));

    const outcome = await session.page.evaluate(
      (target) =>
        fetch(target, { headers: { 'X-Intruso': '1' } }).then(
          () => 'respondio',
          () => 'bloqueado',
        ),
      url,
    );

    expect(outcome).toBe('bloqueado');
  });

  it('un Range fuera del archivo responde 416 con el tamano total', async () => {
    const url = fileUrl(inWorkspace('texto-plano.txt'));
    const total = Number((await fetchReply(session.page, url)).contentLength);

    const reply = await fetchReply(session.page, url, 'bytes=9999-');

    expect(reply.status).toBe(416);
    expect(reply.contentRange).toBe(`bytes */${total}`);
  });

  it('un archivo mayor de 5 MiB se sirve por rangos sin pasar por el editor', async () => {
    const url = fileUrl(inWorkspace('grande.txt'));

    const reply = await fetchReply(session.page, url, 'bytes=100-199');

    expect(reply.status).toBe(206);
    expect(reply.text.length).toBe(100);
  });

  it('salir de la raiz con .. codificado responde 403 aunque el destino exista', async () => {
    const targets = [
      `${WORKSPACE_FILE_ORIGIN}/%2e%2e%2fmanifest.json`,
      `${WORKSPACE_FILE_ORIGIN}/${wcDir}/..%5C..%5Cmanifest.json`,
      `${WORKSPACE_FILE_ORIGIN}/%2E%2E%5Cmanifest.json`,
    ];
    for (const url of targets) {
      expect((await fetchReply(session.page, url)).status).toBe(403);
    }
  });

  it('.svn, .SVN y rutas absolutas responden 403', async () => {
    const targets = [
      fileUrl(inWorkspace('.svn/wc.db')),
      fileUrl(inWorkspace('.SVN/wc.db')),
      fileUrl(manifest.config_path),
      `${WORKSPACE_FILE_ORIGIN}/${encodeURIComponent(manifest.config_path)}`,
    ];
    for (const url of targets) {
      expect((await fetchReply(session.page, url)).status).toBe(403);
    }
  });

  it('nombres con #, %, espacios y ñ se sirven bien', async () => {
    const reply = await fetchReply(
      session.page,
      fileUrl(inWorkspace(SPECIAL_NAME)),
    );

    expect(reply.status).toBe(200);
    expect(reply.text).toBe(SPECIAL_CONTENT);
  });

  it('un ? solo existe codificado como %3F y como no existe en NTFS responde 404', async () => {
    const encoded = encodeURIComponent('a?b.txt');
    const reply = await fetchReply(
      session.page,
      `${WORKSPACE_FILE_ORIGIN}/${wcDir}/${encoded}`,
    );

    expect(encoded).toContain('%3F');
    expect(reply.status).toBe(404);
  });

  it('un archivo inexistente responde 404', async () => {
    const reply = await fetchReply(
      session.page,
      fileUrl(inWorkspace('no-existe.png')),
    );

    expect(reply.status).toBe(404);
  });

  it('el SVG con script se ve como imagen sin ejecutarse y llega con las cabeceras de seguridad', async () => {
    const url = fileUrl(inWorkspace(SVG_NAME));
    const reply = await fetchReply(session.page, url);
    await showImage(session.page, url);
    const headers = await waitForHeaders(url);

    expect(reply.contentType).toBe('image/svg+xml');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toBe(
      "default-src 'none'; sandbox",
    );
    expect(headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['accept-ranges']).toBe('bytes');
  });

  it('no hubo peticiones externas ni violaciones de CSP', async () => {
    expect(session.externalRequests).toEqual([]);
    expect(await session.cspViolations()).toEqual([]);
  });
});

async function waitForHeaders(url: string): Promise<Record<string, string>> {
  const deadline = Date.now() + VISIBLE_TIMEOUT_MS;
  while (!responseHeaders.has(url) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
  return responseHeaders.get(url) ?? {};
}
