import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import { launchApp, readJson, type AppSession } from './harness';
import { ipcCalls, setIpcFake } from './ipcGate';

const EXPLORER = '[aria-label="Explorador de archivos"]';
const STATUS_BAR = '[aria-label="Estado del documento"]';
const IPC_ORIGIN = 'http://ipc.localhost';
const VISIBLE_TIMEOUT_MS = 30_000;
const SCRATCH_DIR = 'e2e-editor';
const WC_NAME = 'wc';
const THEMES = ['light', 'dark'] as const;
const CLEANUP_RETRIES = 5;
const CLEANUP_RETRY_DELAY_MS = 200;
const LARGE_FILE_BYTES = 6 * 1024 * 1024;
const HEX_ROW_BYTES = 16;
const LAST_LARGE_OFFSET = (LARGE_FILE_BYTES - HEX_ROW_BYTES)
  .toString(16)
  .toUpperCase()
  .padStart(8, '0');
const BINARY_FILE_ROWS = 2048 / HEX_ROW_BYTES;
const CLOUD_FILE = 'texto-plano.txt';
const CLOUD_SIZE_BYTES = 3 * 1024 * 1024;
const MAX_CHUNK_REQUESTS_AT_START = 3;
const MAX_ROWS_IN_DOM = 100;
const MIXED_EOL_TEXT = 'uno\r\ndos\ntres\n';
const BACKGROUND_TOLERANCE = 0;
const SAMPLE_TOKENS = ['//', 'const', "'hola'"];
const TYPESCRIPT_WORKER = 'ts.worker';
const BAD_JSON = '{\n  "nombre": ,\n  "valor": 1\n}\n';
const CSS_TEXT = 'body {\n  color: #123456;\n}\n';
const THEME_BUTTON: Record<(typeof THEMES)[number], string> = {
  light: 'Tema claro',
  dark: 'Tema oscuro',
};

let session: AppSession | undefined;
let manifest: FixtureManifest;
let seedRoot: string;
const scratchDirs: string[] = [];

beforeAll(() => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
});

afterEach(() => {
  session?.stop();
  session = undefined;
  removeDir(scratchFolder());
});

afterAll(() => {
  scratchDirs.forEach(removeDir);
  stopFixtures(seedRoot);
});

function removeDir(path: string): void {
  rmSync(path, {
    recursive: true,
    force: true,
    maxRetries: CLEANUP_RETRIES,
    retryDelay: CLEANUP_RETRY_DELAY_MS,
  });
}

function scratchFolder(...parts: string[]): string {
  return join(manifest.workspace_root, SCRATCH_DIR, ...parts);
}

function writeScratch(name: string, content: string): void {
  mkdirSync(scratchFolder(), { recursive: true });
  writeFileSync(scratchFolder(name), content);
}

function newConfigDir(): string {
  const config = readJson<Record<string, unknown>>(manifest.config_path);
  const dir = mkdtempSync(join(tmpdir(), 'dakedaduck-cfg-editor-'));
  scratchDirs.push(dir);
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}

async function launchExplorer(): Promise<AppSession> {
  const app = await launchApp({ configDir: newConfigDir() });
  session = app;
  await app.page.locator(EXPLORER).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  await app.page.getByRole('grid').waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  return app;
}

function fileRow(page: Page, name: string): Locator {
  return page.getByRole('row', { name: `Archivo: ${name}`, exact: true });
}

async function enter(page: Page, name: string): Promise<void> {
  await page
    .getByRole('row', { name: `Carpeta: ${name}`, exact: true })
    .dblclick();
  await page
    .getByRole('navigation', { name: 'Ruta de navegación' })
    .locator('[aria-current="page"]', { hasText: name })
    .waitFor();
}

async function openFile(
  page: Page,
  folder: string,
  name: string,
): Promise<void> {
  await enter(page, folder);
  await fileRow(page, name).dblclick();
  await page.getByRole('tab', { name, exact: true }).waitFor();
}

async function openEditor(
  app: AppSession,
  folder: string,
  name: string,
): Promise<Locator> {
  await openFile(app.page, folder, name);
  const bar = app.page.locator(STATUS_BAR);
  await bar.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  await app.page.locator('.monaco-editor').waitFor();
  return bar;
}

async function statusItems(bar: Locator): Promise<string[]> {
  const items = await bar.locator('span').allInnerTexts();
  return items.map((item) => item.trim());
}

async function showTheme(
  page: Page,
  theme: (typeof THEMES)[number],
): Promise<void> {
  const current = await page.evaluate(
    () =>
      document.documentElement.getAttribute('data-theme') ??
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  if (current !== theme) {
    await page.getByRole('button', { name: THEME_BUTTON[theme] }).click();
  }
  await expect
    .poll(() => editorMatchesPageBackground(page), { timeout: 10_000 })
    .toBe(true);
}

function editorMatchesPageBackground(page: Page): Promise<boolean> {
  return page.evaluate((tolerance) => {
    const editor = document.querySelector('.monaco-editor-background');
    if (!editor) return false;
    const channels = (element: Element) =>
      getComputedStyle(element).backgroundColor.match(/\d+/g)?.map(Number) ??
      [];
    const editorRgb = channels(editor);
    const pageRgb = channels(document.body);
    return (
      editorRgb.length > 0 &&
      editorRgb.every((value, i) => Math.abs(value - pageRgb[i]) <= tolerance)
    );
  }, BACKGROUND_TOLERANCE);
}

async function captureBothThemes(
  app: AppSession,
  name: string,
  isEditor = true,
): Promise<void> {
  for (const theme of THEMES) {
    if (isEditor) await showTheme(app.page, theme);
    else await switchTheme(app.page, theme);
    await app.capture(`${name}-${theme}`);
  }
}

async function switchTheme(
  page: Page,
  theme: (typeof THEMES)[number],
): Promise<void> {
  const button = page.getByRole('button', { name: THEME_BUTTON[theme] });
  if ((await button.count()) > 0) await button.click();
}

async function expectCleanSession(app: AppSession): Promise<void> {
  expect(app.externalRequests).toEqual([]);
  expect(await app.cspViolations()).toEqual([]);
}

function trackIpc(page: Page, command: string): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.url() === `${IPC_ORIGIN}/${command}`) seen.push(command);
  });
  return seen;
}

function hexTable(page: Page): Locator {
  return page.getByRole('table', { name: /Contenido hexadecimal/ });
}

async function lastRowOffset(page: Page): Promise<string> {
  const offsets = await page
    .locator('.hex-viewer__row .hex-viewer__offset')
    .allInnerTexts();
  return offsets.at(-1) ?? '';
}

describe('resaltado y barra de estado del editor de lectura', () => {
  it('resalta un archivo versionado por su extensión con tokens distintos y colores del tema', async () => {
    const app = await launchExplorer();
    const bar = await openEditor(app, WC_NAME, 'ejemplo.js');
    const { page } = app;

    await page
      .locator('.view-line')
      .filter({ hasText: 'const saludo' })
      .waitFor();
    await expect
      .poll(async () => {
        const found = await tokenColors(page, SAMPLE_TOKENS);
        return new Set(found.map((token) => token.className)).size;
      })
      .toBe(SAMPLE_TOKENS.length);
    const tokens = await tokenColors(page, SAMPLE_TOKENS);
    const classes = tokens.map((token) => token.className);
    expect(new Set(classes).size).toBe(classes.length);
    expect(classes.every((name) => name.startsWith('mtk'))).toBe(true);
    expect(new Set(tokens.map((token) => token.color)).size).toBe(3);

    const items = await statusItems(bar);
    expect(items).toEqual(
      expect.arrayContaining(['JavaScript', 'UTF-8', 'sin BOM', 'LF']),
    );
    expectNoTypescriptWorker(page);
    await expectFindWidgetAndIcons(page);
    await captureBothThemes(app, 'i11-editor-resaltado');
    await expectCleanSession(app);
  });

  it('informa BOM, CRLF y UTF-16 en la barra de estado', async () => {
    const app = await launchExplorer();
    await openFile(app.page, WC_NAME, 'utf8-bom-crlf.txt');
    const bar = app.page.locator(STATUS_BAR);
    await bar.waitFor();
    expect(await statusItems(bar)).toEqual(
      expect.arrayContaining(['UTF-8', 'con BOM', 'CRLF']),
    );
    await captureBothThemes(app, 'i11-editor-estado-bom-crlf');

    await fileOpenedFromTree(app.page, WC_NAME, 'utf16le-bom.txt');
    expect(await statusItems(app.page.locator(STATUS_BAR))).toEqual(
      expect.arrayContaining(['UTF-16 LE', 'con BOM', 'CRLF']),
    );

    await fileOpenedFromTree(app.page, WC_NAME, 'lf.txt');
    expect(await statusItems(app.page.locator(STATUS_BAR))).toEqual(
      expect.arrayContaining(['UTF-8', 'sin BOM', 'LF']),
    );
    await expectCleanSession(app);
  });

  it('avisa del fin de línea mixto y carga los servicios de JSON y CSS sin violar la CSP', async () => {
    writeScratch('mixto.txt', MIXED_EOL_TEXT);
    writeScratch('datos.json', BAD_JSON);
    writeScratch('estilo.css', CSS_TEXT);
    const app = await launchExplorer();
    const { page } = app;
    const bar = await openEditor(app, SCRATCH_DIR, 'mixto.txt');
    expect(await bar.innerText()).toContain('Fin de línea mixto');
    await app.capture('i11-editor-eol-mixto-light');

    await fileOpenedFromTree(page, SCRATCH_DIR, 'datos.json');
    expect(await statusItems(page.locator(STATUS_BAR))).toContain('JSON');
    await expectWorkerLoaded(page, 'json.worker');

    await fileOpenedFromTree(page, SCRATCH_DIR, 'estilo.css');
    expect(await statusItems(page.locator(STATUS_BAR))).toContain('CSS');
    await expectWorkerLoaded(page, 'css.worker');
    await expectCleanSession(app);
  });
});

async function fileOpenedFromTree(
  page: Page,
  folderTab: string,
  name: string,
): Promise<void> {
  await page.getByRole('tab', { name: folderTab, exact: true }).click();
  await fileRow(page, name).dblclick();
  await page.getByRole('tab', { name, exact: true }).waitFor();
  await page.locator(STATUS_BAR).waitFor();
  await expect
    .poll(() => page.locator('.text-editor__title').innerText())
    .toBe(name);
}

interface TokenColor {
  className: string;
  color: string;
}

function tokenColors(page: Page, texts: string[]): Promise<TokenColor[]> {
  return page.evaluate((wanted) => {
    const spans = [...document.querySelectorAll('.view-line span span')];
    return wanted.flatMap((text) => {
      const span = spans.find((item) => item.textContent?.includes(text));
      if (!span) return [];
      return [
        { className: span.className, color: getComputedStyle(span).color },
      ];
    });
  }, texts);
}

async function expectFindWidgetAndIcons(page: Page): Promise<void> {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+F');
  await page.locator('.find-widget.visible').waitFor();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.fonts].some(
          (font) => font.family.includes('codicon') && font.status === 'loaded',
        ),
      ),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
}

function expectNoTypescriptWorker(page: Page): void {
  const urls = page.workers().map((worker) => worker.url());
  expect(urls.some((url) => url.includes(TYPESCRIPT_WORKER))).toBe(false);
}

async function expectWorkerLoaded(page: Page, name: string): Promise<void> {
  await expect
    .poll(() => page.workers().some((worker) => worker.url().includes(name)))
    .toBe(true);
}

describe('binarios, tope del editor y hexadecimal', () => {
  it('un .md binario cae a BinaryCard y nunca se interpreta como texto', async () => {
    const app = await launchExplorer();
    const { page } = app;
    await openFile(page, WC_NAME, 'falso.md');
    const card = page.getByRole('article', { name: 'Archivo falso.md' });
    await card.waitFor();
    expect(await page.locator('.monaco-editor').count()).toBe(0);
    const text = await card.innerText();
    expect(text).toContain('Archivo binario (.md)');
    expect(text).toContain('application/octet-stream');
    expect(text).toContain('nunca se interpreta como texto');
    await captureBothThemes(app, 'i11-binarycard', false);

    await card.getByRole('button', { name: 'Mostrar hexadecimal' }).click();
    await hexTable(page).waitFor();
    await captureBothThemes(app, 'i11-hexadecimal-falso-md', false);
    await expectCleanSession(app);
  });

  it('un .bin se ve en hexadecimal con filas de 16 bytes', async () => {
    const app = await launchExplorer();
    const { page } = app;
    await openFile(page, WC_NAME, 'datos.bin');
    await page.getByRole('button', { name: 'Mostrar hexadecimal' }).click();
    const table = hexTable(page);
    await table.waitFor();
    expect(await table.getAttribute('aria-rowcount')).toBe(
      String(BINARY_FILE_ROWS),
    );
    const firstRow = page.locator('.hex-viewer__row').first();
    expect(await firstRow.locator('.hex-viewer__offset').innerText()).toBe(
      '00000000',
    );
    await expect
      .poll(() => firstRow.locator('.hex-viewer__bytes span').allInnerTexts())
      .toHaveLength(HEX_ROW_BYTES);
    await expect
      .poll(async () => (await firstRow.innerText()).includes('··'))
      .toBe(false);
    await expectCleanSession(app);
  });

  it('grande.txt supera el tope: se ofrece como hexadecimal y desplazar lee otros tramos', async () => {
    const app = await launchExplorer();
    const { page } = app;
    const chunkRequests = trackIpc(page, 'fs_read_chunk');
    const textRequests = trackIpc(page, 'fs_read_text');
    await openFile(page, WC_NAME, 'grande.txt');
    const card = page.getByRole('article', { name: 'Archivo grande.txt' });
    await card.waitFor();
    expect(await card.innerText()).toContain('Supera el tamaño máximo');
    expect(await page.locator('.monaco-editor').count()).toBe(0);

    await card.getByRole('button', { name: 'Mostrar hexadecimal' }).click();
    const table = hexTable(page);
    await table.waitFor();
    await expect
      .poll(() => page.locator('.hex-viewer__row').first().innerText())
      .toContain('xxxxxxxxxxxxxxxx');
    expect(chunkRequests.length).toBeLessThanOrEqual(
      MAX_CHUNK_REQUESTS_AT_START,
    );
    await app.capture('i11-hexadecimal-archivo-grande-light');

    const before = chunkRequests.length;
    await table.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => lastRowOffset(page)).toBe(LAST_LARGE_OFFSET);
    await expect.poll(() => chunkRequests.length).toBeGreaterThan(before);
    expect(await page.locator('.hex-viewer__row').count()).toBeLessThan(
      MAX_ROWS_IN_DOM,
    );
    expect(textRequests).toEqual([]);
    await captureBothThemes(app, 'i11-hexadecimal-final-archivo-grande', false);
    await expectCleanSession(app);
  });
});

function simulateCloudFile(page: Page, fileName: string): Promise<void> {
  return setIpcFake(page, 'fs_probe', {
    pathSuffix: fileName,
    args: { allow_download: false },
    body: {
      kind: 'cloud',
      mime: 'application/octet-stream',
      len: CLOUD_SIZE_BYTES,
      extension: null,
    },
  });
}

describe('archivo solo en la nube', () => {
  it('muestra la tarjeta sin leer el contenido y «Descargar y abrir» repite el sondeo con descarga', async () => {
    const app = await launchExplorer();
    const { page } = app;
    const readCounters = [
      trackIpc(page, 'fs_read_text'),
      trackIpc(page, 'fs_read_chunk'),
    ];
    await simulateCloudFile(page, CLOUD_FILE);
    await openFile(page, WC_NAME, CLOUD_FILE);

    const card = page.getByRole('article', { name: `Archivo ${CLOUD_FILE}` });
    await card.waitFor();
    const text = await card.innerText();
    expect(text).toContain('solo en la nube');
    expect(text).toContain('3 MB');
    expect(readCounters.flat()).toEqual([]);
    expect(await ipcCalls(page)).toContainEqual(
      expect.objectContaining({ command: 'fs_probe', rule: 'fake' }),
    );
    await captureBothThemes(app, 'i11-tarjeta-nube', false);

    await card.getByRole('button', { name: 'Descargar y abrir' }).click();
    await page.locator(STATUS_BAR).waitFor();
    expect(await page.locator('.monaco-editor').count()).toBe(1);
    expect(readCounters[0].length).toBeGreaterThan(0);
    await expectCleanSession(app);
  });
});
