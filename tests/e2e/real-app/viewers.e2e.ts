import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { XSS_CORPUS } from '../../../src/documents/markdown/xssCorpus';
import {
  launchExplorer,
  newConfigDir,
  removeDir,
  waitForEditor,
} from './editorDriver';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import { isAllowedRequest, type AppSession } from './harness';
import {
  cjkPdf,
  cmykPdf,
  embeddedFontPdf,
  jbig2Pdf,
  jpegPdf,
  jpxPdf,
  paddedPdf,
  standardFontsPdf,
} from './pdfFixtures';
import {
  BLOCKED_SELECTOR,
  PREVIEW,
  SCRATCH_FOLDER,
  VISIBLE_TIMEOUT_MS,
  auditPreview,
  bigVectorSvg,
  captureBothThemes,
  centerPixel,
  chooseMode,
  closeDocument,
  darkPixelsByBand,
  headerOnlyPng,
  executedPayload,
  gradientPng,
  loadedImages,
  modeButton,
  openInFolder,
  trackDialogs,
  trackNetwork,
  type NetworkLog,
  type PageEvents,
} from './viewersDriver';

const WC = 'wc';
const NEWLINE = String.fromCharCode(10);
const SUITE_TIMEOUT_MS = 600_000;
const CORPUS_TIMEOUT_MS = 480_000;
const LARGE_PDF_PADDING_BYTES = 40 * 1024 * 1024;
const MARKDOWN_IMAGE_COUNT = 3;
const REMOTE_IMAGE_COUNT = 4;
const PDF_PAGES = 5;
const MARKDOWN_HEADER = '# Carga de prueba\n\n';
const WORKSPACE_FILE_HOST = 'workspace-file.localhost';
const IMAGE_SIZE = { width: 240, height: 160 };
const NESTING_LEVELS = 170_000;
const NESTED_END_MARK = 'Fin del documento anidado';
const NESTED_RENDER_BUDGET_MS = 30_000;
const PDF_ASSET_PATH = '/assets/pdfjs/';
const MID_GRAY = 128;
const GRAY_TOLERANCE = 3;
const MIN_DARK_PIXELS_PER_LINE = 100;

let manifest: FixtureManifest;
let seedRoot: string;
let app: AppSession;
let events: PageEvents;
let network: NetworkLog;
const keep: string[] = [];

function scratchFile(name: string, content: string | Buffer): void {
  const folder = join(manifest.workspace_root, SCRATCH_FOLDER);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), content);
}

function nestedBaseMarkdown(): string {
  const nested = `<div>${'<'.repeat(NESTING_LEVELS)}<base href="http://evil.test/x">${'base>'.repeat(NESTING_LEVELS)}`;
  return `${MARKDOWN_HEADER}${nested}\n\n${NESTED_END_MARK}\n`;
}

function previewText(page: Page): Promise<string> {
  return page.locator(PREVIEW).innerText();
}

async function openPreview(name: string, folder = WC): Promise<void> {
  await openInFolder(app.page, folder, name);
  await chooseMode(app.page, 'Vista previa');
  await app.page.locator(PREVIEW).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
}

beforeAll(async () => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
  scratchFile(
    'degradado.png',
    gradientPng(IMAGE_SIZE.width, IMAGE_SIZE.height),
  );
  scratchFile('vector-grande.svg', bigVectorSvg());
  scratchFile('grande.pdf', paddedPdf(2, LARGE_PDF_PADDING_BYTES));
  scratchFile(
    'solo-cabecera.png',
    headerOnlyPng(gradientPng(IMAGE_SIZE.width, IMAGE_SIZE.height)),
  );
  scratchFile('cmyk.pdf', cmykPdf());
  scratchFile('roto.pdf', '%PDF-1.4\nesto no es un pdf valido\n');
  scratchFile('anidado-grande.md', nestedBaseMarkdown());
  scratchFile('cjk.pdf', cjkPdf());
  scratchFile('estandar.pdf', standardFontsPdf());
  scratchFile('incrustada.pdf', embeddedFontPdf());
  scratchFile('jpx.pdf', jpxPdf());
  scratchFile('jpeg.pdf', jpegPdf());
  scratchFile('jbig2.pdf', jbig2Pdf());
  XSS_CORPUS.forEach(({ markdown }, index) =>
    scratchFile(`xss-${index}.md`, `${MARKDOWN_HEADER}${markdown}`),
  );
  app = await launchExplorer(newConfigDir(manifest, keep));
  events = trackDialogs(app.page);
  network = trackNetwork(app.page);
}, SUITE_TIMEOUT_MS);

afterAll(() => {
  app?.stop();
  keep.forEach(removeDir);
  stopFixtures(seedRoot);
  removeDir(seedRoot);
});

describe('Markdown en la ventana real: adversarial primero', () => {
  it('las imágenes remotas no se piden y se muestran como bloqueadas', async () => {
    await openPreview('markdown-remoto.md');
    await expect
      .poll(() => app.page.locator(`${PREVIEW} ${BLOCKED_SELECTOR}`).count())
      .toBe(REMOTE_IMAGE_COUNT);
    expect(await app.page.locator(`${PREVIEW} img`).count()).toBe(0);
    expect(app.externalRequests.join(NEWLINE)).toBe('');
    expect((await app.cspViolations()).join(NEWLINE)).toBe('');
    await closeDocument(app.page, 'markdown-remoto.md');
  });

  it('las cargas XSS del fixture quedan saneadas y nada se ejecuta', async () => {
    await openPreview('markdown-xss.md');
    expect(await auditPreview(app.page)).toEqual([]);
    expect(await previewText(app.page)).toContain('Texto seguro.');
    expect(await executedPayload(app.page)).toBeUndefined();
    expect(events.dialogs).toEqual([]);
    await closeDocument(app.page, 'markdown-xss.md');
  });

  it(
    'el corpus XSS completo, uno por uno, no deja nada activo en el DOM real',
    async () => {
      const failures: string[] = [];
      for (const [index, payload] of XSS_CORPUS.entries()) {
        const name = `xss-${index}.md`;
        await openPreview(name, SCRATCH_FOLDER);
        const found = await auditPreview(app.page);
        if (found.length > 0) failures.push(`${payload.name}: ${found}`);
        if ((await executedPayload(app.page)) !== undefined) {
          failures.push(`${payload.name}: se ejecutó`);
        }
        await closeDocument(app.page, name);
      }
      expect(failures.join(NEWLINE)).toBe('');
      expect(events.dialogs).toEqual([]);
      expect(app.externalRequests.join(NEWLINE)).toBe('');
      expect((await app.cspViolations()).join(NEWLINE)).toBe('');
    },
    CORPUS_TIMEOUT_MS,
  );

  it('un anidamiento de ~1 MB de <base> se renderiza en tiempo acotado y sin violaciones', async () => {
    const started = Date.now();
    await openPreview('anidado-grande.md', SCRATCH_FOLDER);
    await expect
      .poll(() => previewText(app.page), { timeout: NESTED_RENDER_BUDGET_MS })
      .toContain(NESTED_END_MARK);
    expect(Date.now() - started).toBeLessThan(NESTED_RENDER_BUDGET_MS);
    expect((await app.cspViolations()).join(NEWLINE)).toBe('');
    expect(app.externalRequests.join(NEWLINE)).toBe('');
    await closeDocument(app.page, 'anidado-grande.md');
  });

  it('un .md binario sigue cayendo a la tarjeta binaria, sin modos de Markdown', async () => {
    await openInFolder(app.page, WC, 'falso.md');
    await app.page.getByText('Mostrar hexadecimal').waitFor();
    expect(await modeButton(app.page, 'Vista previa').count()).toBe(0);
    await closeDocument(app.page, 'falso.md');
  });

  it('un clic en un enlace de la vista previa no navega ni abre nada', async () => {
    await openPreview('markdown-imagen.md');
    const before = app.page.url();
    const pagesBefore = app.page.context().pages().length;
    const link = app.page.locator(`${PREVIEW} a`, {
      hasText: 'enlace externo',
    });
    await link.click();
    await link.click({ button: 'middle' });
    expect(app.page.url()).toBe(before);
    expect(app.page.context().pages()).toHaveLength(pagesBefore);
    expect(await link.getAttribute('href')).toBeNull();
    expect(app.externalRequests.join(NEWLINE)).toBe('');
    await closeDocument(app.page, 'markdown-imagen.md');
  });
});

describe('Markdown en la ventana real', () => {
  it('la imagen relativa carga por el protocolo y hay tres modos con capturas', async () => {
    await openInFolder(app.page, WC, 'markdown-imagen.md');
    await app.page.locator('.monaco-editor').waitFor();
    await captureBothThemes(app, 'i13-markdown-editor');

    await chooseMode(app.page, 'Vista previa');
    await expect
      .poll(async () => (await loadedImages(app.page, `${PREVIEW} img`)).length)
      .toBe(MARKDOWN_IMAGE_COUNT);
    await expect
      .poll(async () =>
        (await loadedImages(app.page, `${PREVIEW} img`)).every(
          (image) => image.width > 0,
        ),
      )
      .toBe(true);
    const sources = (await loadedImages(app.page, `${PREVIEW} img`)).map(
      (image) => image.src,
    );
    expect(
      sources.every((src) => new URL(src).host === WORKSPACE_FILE_HOST),
    ).toBe(true);
    expect(sources).toContain(
      `http://${WORKSPACE_FILE_HOST}/wc/pixel%20%C3%B1%20%231.png`,
    );
    await captureBothThemes(app, 'i13-markdown-vista-previa');

    await chooseMode(app.page, 'Dividido');
    await app.page
      .getByRole('separator', {
        name: 'Redimensionar editor y vista previa',
      })
      .waitFor();
    await app.page.locator('.monaco-editor').waitFor({ state: 'visible' });
    await captureBothThemes(app, 'i13-markdown-dividido');
    expect((await app.cspViolations()).join(NEWLINE)).toBe('');
    expect(app.externalRequests.join(NEWLINE)).toBe('');
  });

  it('la vista previa sigue el texto actual del editor', async () => {
    await chooseMode(app.page, 'Dividido');
    await app.page.locator('.monaco-editor .view-lines').click();
    await app.page.keyboard.press('Control+End');
    await app.page.keyboard.type('\n\nLINEA-EN-VIVO');
    await expect
      .poll(() => previewText(app.page), { timeout: VISIBLE_TIMEOUT_MS })
      .toContain('LINEA-EN-VIVO');
    await app.page.keyboard.press('Control+z');
    await app.page.keyboard.press('Control+z');
    await expect
      .poll(() => previewText(app.page))
      .not.toContain('LINEA-EN-VIVO');
  });

  it('el modo Editor oculta la vista previa y conserva el texto', async () => {
    await chooseMode(app.page, 'Editor');
    expect(await app.page.locator(PREVIEW).count()).toBe(0);
    await app.page.locator('.monaco-editor').waitFor({ state: 'visible' });
    await waitForEditor(app.page);
  });
});

describe('Imágenes en la ventana real', () => {
  it('un PNG carga por el protocolo, ajusta y pasa a 100 %', async () => {
    await openInFolder(app.page, SCRATCH_FOLDER, 'degradado.png');
    const image = app.page.locator('.image-viewer__image');
    await expect
      .poll(
        async () =>
          (await loadedImages(app.page, '.image-viewer__image'))[0]?.width,
      )
      .toBe(IMAGE_SIZE.width);
    await app.page.getByText('240 × 160 px').waitFor();
    await captureBothThemes(app, 'i13-imagen');

    const actual = app.page.getByRole('button', { name: '100 %', exact: true });
    await actual.click();
    await expect.poll(() => actual.getAttribute('aria-pressed')).toBe('true');
    await expect
      .poll(() => image.evaluate((el) => el.getBoundingClientRect().width))
      .toBe(IMAGE_SIZE.width);
    await closeDocument(app.page, 'degradado.png');
  });

  it('un SVG con script se muestra como imagen, no ejecuta y «Ver código» lo enseña', async () => {
    await openInFolder(app.page, SCRATCH_FOLDER, 'vector-grande.svg');
    await expect
      .poll(
        async () =>
          (await loadedImages(app.page, '.image-viewer__image'))[0]?.width,
      )
      .toBeGreaterThan(0);
    expect(
      await app.page.locator('.image-viewer svg:not(.app-icon)').count(),
    ).toBe(0);
    expect(await app.page.locator('.image-viewer script').count()).toBe(0);
    await captureBothThemes(app, 'i13-svg-imagen');

    await app.page
      .getByRole('button', { name: 'Ver código', exact: true })
      .click();
    await waitForEditor(app.page);
    await expect
      .poll(() => app.page.locator('.monaco-editor .view-lines').innerText())
      .toContain('alert');
    await captureBothThemes(app, 'i13-svg-codigo');

    await app.page
      .getByRole('button', { name: 'Ver imagen', exact: true })
      .click();
    await app.page.locator('.image-viewer__image').waitFor();
    expect(events.dialogs).toEqual([]);
    expect(await executedPayload(app.page)).toBeUndefined();
    await closeDocument(app.page, 'vector-grande.svg');
  });

  it('el SVG del fixture con script tampoco ejecuta y el PNG mínimo carga', async () => {
    await openInFolder(app.page, WC, 'vector-con-script.svg');
    await app.page.locator('.image-viewer__image').waitFor();
    await closeDocument(app.page, 'vector-con-script.svg');
    await openInFolder(app.page, WC, 'imagen.png');
    await expect
      .poll(
        async () =>
          (await loadedImages(app.page, '.image-viewer__image'))[0]?.width,
      )
      .toBe(1);
    expect(events.dialogs).toEqual([]);
    await closeDocument(app.page, 'imagen.png');
  });

  it('una imagen que no decodifica cae a la tarjeta binaria', async () => {
    await openInFolder(app.page, SCRATCH_FOLDER, 'solo-cabecera.png');
    await app.page.getByText('No se pudo mostrar la imagen').waitFor();
    await closeDocument(app.page, 'solo-cabecera.png');
  });
});

describe('PDF en la ventana real', () => {
  async function paintedPixels(): Promise<number> {
    return app.page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '.pdf-viewer__canvas',
      );
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return 0;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 100 && data[i + 3] > 0) dark += 1;
      }
      return dark;
    });
  }

  const status = () => app.page.locator('.viewer-frame__bar');

  it('muestra la primera página con su número de páginas correcto', async () => {
    await openInFolder(app.page, WC, 'documento-multipagina.pdf');
    await expect
      .poll(() => status().innerText(), { timeout: VISIBLE_TIMEOUT_MS })
      .toContain(`Página 1 de ${PDF_PAGES}`);
    await expect.poll(paintedPixels).toBeGreaterThan(0);
    await captureBothThemes(app, 'i13-pdf');
  });

  it('pagina con botones, con el número escrito y con el teclado', async () => {
    const next = app.page.getByRole('button', { name: 'Página siguiente' });
    await next.click();
    await expect
      .poll(() => status().innerText())
      .toContain(`Página 2 de ${PDF_PAGES}`);
    const input = app.page.getByLabel('Número de página');
    await input.fill('5');
    await input.press('Enter');
    await expect
      .poll(() => status().innerText())
      .toContain(`Página 5 de ${PDF_PAGES}`);
    await expect.poll(() => next.isDisabled()).toBe(true);
    await input.fill('99');
    await input.press('Enter');
    await expect
      .poll(() => status().innerText())
      .toContain(`Página 5 de ${PDF_PAGES}`);
    await app.page.getByRole('region', { name: /Páginas de/ }).press('Home');
    await expect
      .poll(() => status().innerText())
      .toContain(`Página 1 de ${PDF_PAGES}`);
    await expect.poll(paintedPixels).toBeGreaterThan(0);
  });

  it('acerca y aleja: el lienzo cambia de tamaño y el porcentaje lo anuncia', async () => {
    const canvasWidth = () =>
      app.page
        .locator('.pdf-viewer__canvas')
        .evaluate((el) => el.getBoundingClientRect().width);
    const zoom = app.page.getByLabel('Zoom actual');
    const initial = await canvasWidth();
    await app.page.getByRole('button', { name: 'Acercar' }).click();
    await expect.poll(canvasWidth).toBeGreaterThan(initial);
    const zoomedLabel = await zoom.innerText();
    await app.page.getByRole('button', { name: 'Alejar' }).click();
    await app.page.getByRole('button', { name: 'Alejar' }).click();
    await expect.poll(canvasWidth).toBeLessThan(initial);
    expect(await zoom.innerText()).not.toBe(zoomedLabel);
    await app.page.getByRole('button', { name: 'Ajustar al ancho' }).click();
    await expect.poll(paintedPixels).toBeGreaterThan(0);
  });

  it('un PDF de una página deshabilita ambas flechas', async () => {
    await closeDocument(app.page, 'documento-multipagina.pdf');
    await openInFolder(app.page, WC, 'documento.pdf');
    await expect.poll(() => status().innerText()).toContain('Página 1 de 1');
    await expect
      .poll(() =>
        app.page.getByRole('button', { name: 'Página anterior' }).isDisabled(),
      )
      .toBe(true);
    await expect
      .poll(() =>
        app.page.getByRole('button', { name: 'Página siguiente' }).isDisabled(),
      )
      .toBe(true);
    await closeDocument(app.page, 'documento.pdf');
  });

  it('un PDF mayor que el tope de respuesta se lee por rangos sin error 413', async () => {
    const statuses: number[] = [];
    app.page.on('response', (response) => {
      if (
        response
          .url()
          .includes(`${WORKSPACE_FILE_HOST}/${SCRATCH_FOLDER}/grande.pdf`)
      ) {
        statuses.push(response.status());
      }
    });
    await openInFolder(app.page, SCRATCH_FOLDER, 'grande.pdf');
    await expect
      .poll(() => status().innerText(), { timeout: VISIBLE_TIMEOUT_MS })
      .toContain('Página 1 de 2');
    await expect.poll(paintedPixels).toBeGreaterThan(0);
    expect(statuses.every((code) => code === 200 || code === 206)).toBe(true);
    await closeDocument(app.page, 'grande.pdf');
  });

  it('un PDF con color CMYK se pinta con sus recursos empaquetados y sin violaciones', async () => {
    await openInFolder(app.page, SCRATCH_FOLDER, 'cmyk.pdf');
    await expect
      .poll(() => status().innerText(), { timeout: VISIBLE_TIMEOUT_MS })
      .toContain('Página 1 de 1');
    await expect
      .poll(() =>
        app.page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            '.pdf-viewer__canvas',
          );
          const context = canvas?.getContext('2d');
          if (!canvas || !context) return null;
          const [red, green, blue] = context.getImageData(
            canvas.width / 2,
            canvas.height / 2,
            1,
            1,
          ).data;
          return red > 180 && green < 90 && blue < 90;
        }),
      )
      .toBe(true);
    expect((await app.cspViolations()).join(NEWLINE)).toBe('');
    await closeDocument(app.page, 'cmyk.pdf');
  });

  it('un PDF dañado cae a la tarjeta binaria con su aviso', async () => {
    await openInFolder(app.page, SCRATCH_FOLDER, 'roto.pdf');
    await app.page
      .getByText('No se pudo leer el PDF')
      .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    await closeDocument(app.page, 'roto.pdf');
  });

  it('todo el visor corre sin peticiones externas ni violaciones de CSP', async () => {
    expect(app.externalRequests.join(NEWLINE)).toBe('');
    expect((await app.cspViolations()).join(NEWLINE)).toBe('');
    expect(events.dialogs).toEqual([]);
  });
});

describe('PDF en la ventana real: recursos de pdf.js bajo la CSP real', () => {
  const statusBar = () => app.page.locator('.viewer-frame__bar');

  async function openPdfPage(name: string): Promise<number> {
    const logged = network.responses.length;
    await openInFolder(app.page, SCRATCH_FOLDER, name);
    await expect
      .poll(() => statusBar().innerText(), { timeout: VISIBLE_TIMEOUT_MS })
      .toContain('Página 1 de 1');
    return logged;
  }

  function assetStatuses(since: number): Map<string, number> {
    const found = new Map<string, number>();
    network.responses.slice(since).forEach(({ url, status }) => {
      if (url.includes(PDF_ASSET_PATH))
        found.set(url.split('/').pop() ?? '', status);
    });
    return found;
  }

  async function expectCleanRun(): Promise<void> {
    expect((await app.cspViolations()).join(NEWLINE)).toBe('');
    expect(app.externalRequests.join(NEWLINE)).toBe('');
  }

  it.each([
    [
      'cjk.pdf',
      ['90ms-RKSJ-H.bcmap', 'UniJIS-UCS2-H.bcmap', 'Adobe-Japan1-UCS2.bcmap'],
      2,
    ],
    ['estandar.pdf', ['FoxitSymbol.pfb', 'FoxitDingbats.pfb'], 5],
    ['incrustada.pdf', [], 1],
  ])(
    '%s pide sus recursos al origen de la aplicación y pinta cada línea',
    async (name, assets, lines) => {
      const logged = await openPdfPage(name);
      for (const asset of assets) {
        await expect.poll(() => assetStatuses(logged).get(asset)).toBe(200);
      }
      await expect
        .poll(async () =>
          (await darkPixelsByBand(app.page, lines)).every(
            (dark) => dark >= MIN_DARK_PIXELS_PER_LINE,
          ),
        )
        .toBe(true);
      await expectCleanRun();
      await closeDocument(app.page, name);
    },
  );

  it.each([
    ['jpx.pdf', 'openjpeg.wasm', MID_GRAY],
    ['jpeg.pdf', undefined, MID_GRAY],
    ['jbig2.pdf', 'jbig2.wasm', 0],
  ])(
    '%s decodifica su imagen (%s) y la pinta con el valor esperado',
    async (name, wasm, expected) => {
      const logged = await openPdfPage(name);
      await expect
        .poll(async () => {
          const [red, green, blue] = await centerPixel(app.page);
          return [red, green, blue].every(
            (channel) => Math.abs(channel - expected) <= GRAY_TOLERANCE,
          );
        })
        .toBe(true);
      if (wasm) {
        await expect.poll(() => assetStatuses(logged).get(wasm)).toBe(200);
      }
      await expectCleanRun();
      await closeDocument(app.page, name);
    },
  );

  it('el worker se sirve sin cabecera Content-Security-Policy propia', () => {
    const worker = network.responses.filter(({ url }) =>
      /\/assets\/pdf\.worker-[^/]+\.js$/.test(url),
    );
    expect(worker.length).toBeGreaterThan(0);
    expect(worker.map(({ csp }) => csp)).toEqual(worker.map(() => undefined));
  });

  it('todas las peticiones, también las del worker, van a los orígenes propios', () => {
    const foreign = network.requests.filter(
      (url) => !isAllowedRequest(url, 'debug'),
    );
    expect(foreign.join(NEWLINE)).toBe('');
    expect(network.requests.some((url) => url.includes(PDF_ASSET_PATH))).toBe(
      true,
    );
  });
});
