import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Frame, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storedZip } from './containerFixtures';
import {
  VISIBLE_TIMEOUT_MS,
  documentTab,
  fileRow,
  launchExplorer,
  newConfigDir,
  removeDir,
} from './editorDriver';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import type { AppSession } from './harness';
import { runPowerShell } from './pwsh';
import { closeDocument, enterFolder, showFolder } from './viewersDriver';

const WC = 'wc';
const FOLDER = 'zona-office';
const OFFICE_SCRIPT = 'scripts/e2e/make-office-fixtures.ps1';
const LEGACY_DIR = resolve('tests/fixtures/office/legacy');
const SUITE_TIMEOUT_MS = 600_000;
const OPEN_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 180_000;
const STAGE = '.office-viewer__stage';
const READY_STAGE = `${STAGE}[data-phase="ready"]`;
const FRAME_SELECTOR = 'iframe.office-frame';
const ZETA_HOST = 'zeta-assets.localhost';
const PANEL = '[role="tabpanel"]';
const MACRO_NOTICE = 'no se ejecutan';
const KEY_SETTLE_MS = 1_500;
const DRAW_SETTLE_MS = 4_000;
const LINK_OFFSET_X = 175;
const LINK_OFFSET_Y = 252;
const NAVIGATION_SETTLE_MS = 1_500;

const OFFICE_GENERATED = [
  'documento.docx',
  'hoja.xlsx',
  'presentacion.pptx',
  'documento.odt',
  'hoja.ods',
  'presentacion.odp',
  'macro.docx',
  'macro.odt',
  'enlaces.docx',
];
const LEGACY = ['documento.doc', 'hoja.xls', 'presentacion.ppt'];

const EXPECTED_KIND: [string, string][] = [
  ['documento.docx', 'writer'],
  ['hoja.xlsx', 'calc'],
  ['presentacion.pptx', 'impress'],
  ['documento.odt', 'writer'],
  ['hoja.ods', 'calc'],
  ['presentacion.odp', 'impress'],
  ['documento.doc', 'writer'],
  ['hoja.xls', 'calc'],
  ['presentacion.ppt', 'impress'],
];

let manifest: FixtureManifest;
let seedRoot: string;
let app: AppSession;
const keep: string[] = [];
const consoleLog: string[] = [];

function seedOfficeFolder(): void {
  const folder = join(manifest.wc_path, FOLDER);
  mkdirSync(folder, { recursive: true });
  const generated = mkdtempSync(join(tmpdir(), 'dakedaduck-office-'));
  keep.push(generated);
  runPowerShell(OFFICE_SCRIPT, ['-OutDir', generated]);
  for (const name of OFFICE_GENERATED) {
    copyFileSync(join(generated, name), join(folder, name));
  }
  for (const name of LEGACY) {
    copyFileSync(join(LEGACY_DIR, name), join(folder, name));
  }
  writeFileSync(
    join(folder, 'falso.docx'),
    storedZip([['leeme.txt', 'no soy office']]),
  );
}

function zetaFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame !== page.mainFrame());
}

async function openOffice(name: string): Promise<void> {
  const { page } = app;
  await page.getByRole('tab').first().click();
  await fileRow(page, name).dblclick();
  await documentTab(page, name).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  await page
    .locator(READY_STAGE)
    .waitFor({ timeout: OPEN_TIMEOUT_MS })
    .catch(async (error: Error) => {
      await app.capture(`office-fail-${name}`);
      const text = await page.locator(PANEL).innerText();
      const logs = consoleLog.slice(-8).join(' | ');
      throw new Error(`${error.message} Panel: ${text} Consola: ${logs}`);
    });
}

async function hasLoadedZeta(): Promise<boolean> {
  return app.page.evaluate(
    (host) =>
      performance
        .getEntriesByType('resource')
        .some((entry) => entry.name.includes(host)),
    ZETA_HOST,
  );
}

async function frameCount(): Promise<number> {
  return app.page.locator(FRAME_SELECTOR).count();
}

async function closeAndWaitForRelease(name: string): Promise<void> {
  await closeDocument(app.page, name);
  await app.page.locator(FRAME_SELECTOR).waitFor({
    state: 'detached',
    timeout: VISIBLE_TIMEOUT_MS,
  });
}

beforeAll(async () => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
  seedOfficeFolder();
  app = await launchExplorer(newConfigDir(manifest, keep));
  app.page.on('console', (message) => consoleLog.push(message.text()));
  await showFolder(app.page, WC);
  await enterFolder(app.page, FOLDER);
}, SUITE_TIMEOUT_MS);

afterAll(() => {
  app?.stop();
  keep.forEach(removeDir);
  stopFixtures(seedRoot);
  removeDir(seedRoot);
});

describe('apertura de Office en la ventana real: adversarial primero', () => {
  it(
    'sin abrir un Office no se pide nada a ZetaOffice ni existe el iframe',
    async () => {
      expect(await hasLoadedZeta()).toBe(false);
      expect(await frameCount()).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'un .docx falso cae a la tarjeta de binario y tampoco carga ZetaOffice',
    async () => {
      const { page } = app;
      await fileRow(page, 'falso.docx').dblclick();
      await documentTab(page, 'falso.docx').waitFor({
        timeout: VISIBLE_TIMEOUT_MS,
      });
      await page
        .getByRole('article', { name: 'Archivo falso.docx' })
        .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      expect(await frameCount()).toBe(0);
      expect(await hasLoadedZeta()).toBe(false);
      await closeDocument(page, 'falso.docx');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('apertura de Office en la ventana real: cada formato', () => {
  it.each(EXPECTED_KIND)(
    '%s abre en su propia pestaña como %s, dentro del contenedor y sin salirse',
    async (name, kind) => {
      await openOffice(name);
      const { page } = app;
      await expect(page.locator(STAGE).getAttribute('data-kind')).resolves.toBe(
        kind,
      );
      const frame = zetaFrame(page);
      expect(frame).toBeDefined();
      expect(await frame!.evaluate(() => crossOriginIsolated)).toBe(true);
      const canvasWidth = await frame!.evaluate(
        () => (document.getElementById('qtcanvas') as HTMLCanvasElement).width,
      );
      expect(canvasWidth).toBeGreaterThan(0);
      const inner = await page.locator(FRAME_SELECTOR).boundingBox();
      const panel = await page.locator(PANEL).boundingBox();
      expect(inner).not.toBeNull();
      expect(panel).not.toBeNull();
      expect(inner!.x).toBeGreaterThanOrEqual(panel!.x);
      expect(inner!.y).toBeGreaterThanOrEqual(panel!.y);
      expect(inner!.x + inner!.width).toBeLessThanOrEqual(
        panel!.x + panel!.width + 1,
      );
      expect(inner!.y + inner!.height).toBeLessThanOrEqual(
        panel!.y + panel!.height + 1,
      );
      await app.capture(`office-${name}`);
      await closeAndWaitForRelease(name);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'al cerrar la pestaña el iframe desaparece y se puede abrir otro documento',
    async () => {
      await openOffice('documento.docx');
      await closeAndWaitForRelease('documento.docx');
      expect(await frameCount()).toBe(0);
      await openOffice('hoja.xlsx');
      expect(await frameCount()).toBe(1);
      await closeAndWaitForRelease('hoja.xlsx');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('apertura de Office en la ventana real: macros', () => {
  it.each(['macro.docx', 'macro.odt'])(
    '%s se abre sin ejecutar nada y con el aviso de macros',
    async (name) => {
      await openOffice(name);
      const notice = app.page.getByText(MACRO_NOTICE);
      await notice.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      expect(await frameCount()).toBe(1);
      await closeAndWaitForRelease(name);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'un documento sin macros no muestra el aviso',
    async () => {
      await openOffice('documento.docx');
      expect(await app.page.getByText(MACRO_NOTICE).count()).toBe(0);
      await closeAndWaitForRelease('documento.docx');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('apertura de Office en la ventana real: la frontera de archivos', () => {
  it(
    'Abrir y Guardar como no hacen nada: ni selector, ni ventana, ni descarga, ni navegación',
    async () => {
      const { page } = app;
      const events: string[] = [];
      page.on('filechooser', () => events.push('filechooser'));
      page.on('popup', () => events.push('popup'));
      page.on('download', () => events.push('download'));
      const pagesBefore = page.context().pages().length;
      const urlBefore = page.url();
      await openOffice('documento.docx');
      await page.waitForTimeout(DRAW_SETTLE_MS);
      const box = await page.locator(FRAME_SELECTOR).boundingBox();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.keyboard.press('Control+KeyO');
      await page.waitForTimeout(2500);
      await page
        .locator('[data-command^=".uno:Open"]')
        .waitFor({ timeout: 30_000 });
      await page.keyboard.press('Control+Shift+KeyS');
      await page
        .locator('[data-command^=".uno:SaveAs"]')
        .waitFor({ timeout: 30_000 });
      await page.waitForTimeout(KEY_SETTLE_MS);
      expect(events).toEqual([]);
      expect(page.context().pages().length).toBe(pagesBefore);
      expect(page.url()).toBe(urlBefore);
      expect(await frameCount()).toBe(1);
      await closeAndWaitForRelease('documento.docx');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('apertura de Office en la ventana real: hipervínculos', () => {
  it(
    'un Ctrl+clic sobre un enlace del documento no navega, no abre ventanas ni descarga',
    async () => {
      const { page } = app;
      const events: string[] = [];
      page.on('popup', () => events.push('popup'));
      page.on('download', () => events.push('download'));
      const pagesBefore = page.context().pages().length;
      await openOffice('enlaces.docx');
      await page.waitForTimeout(DRAW_SETTLE_MS);
      const box = await page.locator(FRAME_SELECTOR).boundingBox();
      await page.keyboard.down('Control');
      await page.mouse.click(box!.x + LINK_OFFSET_X, box!.y + LINK_OFFSET_Y);
      await page.keyboard.up('Control');
      await page.waitForTimeout(KEY_SETTLE_MS);
      expect(events).toEqual([]);
      expect(page.context().pages().length).toBe(pagesBefore);
      expect(new URL(page.url()).host).toBe('tauri.localhost');
      await closeAndWaitForRelease('enlaces.docx');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('apertura de Office en la ventana real: sin red ni violaciones', () => {
  it(
    'ni una petición externa (incluida cdn.zetaoffice.net) ni una violación de CSP',
    async () => {
      expect(app.externalRequests).toEqual([]);
      expect(
        app.externalRequests.some((url) => url.includes('zetaoffice.net')),
      ).toBe(false);
      expect(await app.cspViolations()).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'el WebView sigue en el origen de la aplicación tras todo lo anterior',
    async () => {
      await app.page.waitForTimeout(NAVIGATION_SETTLE_MS);
      expect(new URL(app.page.url()).host).toBe('tauri.localhost');
    },
    TEST_TIMEOUT_MS,
  );
});
