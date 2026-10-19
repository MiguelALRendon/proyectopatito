import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BIDI_NAME, MARKUP_NAME, writeArchives } from './archiveFixtures';
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
import {
  captureBothThemes,
  closeDocument,
  enterFolder,
  setTheme,
  showFolder,
  trackDialogs,
} from './viewersDriver';

const WC = 'wc';
const FOLDER = 'zona-comprimidos';
const SUITE_TIMEOUT_MS = 600_000;
const TEST_TIMEOUT_MS = 120_000;
const CANCEL_WAIT_MS = 60_000;
const TABLE = { name: 'Contenido del archivo comprimido' };
const DIALOG_TITLE = /^Extraer «/;
const SNAPSHOT_DIR = join(tmpdir(), 'dakedaduck-a11y-snapshots');

const FORMATS: [string, string, string][] = [
  ['hostil.zip', 'ZIP', 'leeme.txt'],
  ['datos.tar', 'TAR · ', 'docs/nota.txt'],
  ['datos.tar.gz', 'gzip', 'docs/nota.txt'],
  ['simple.7z', '7-Zip', 'docs/nota.txt'],
  ['multifile.rar', 'RAR', ''],
];

let manifest: FixtureManifest;
let seedRoot: string;
let app: AppSession;
let dialogs: string[] = [];
const keep: string[] = [];

const folderPath = (name = '') => join(manifest.wc_path, FOLDER, name);

function table(page: Page): Locator {
  return page.getByRole('table', TABLE);
}

function dialog(page: Page): Locator {
  return page.getByRole('dialog');
}

async function openArchive(page: Page, name: string): Promise<void> {
  await page.getByRole('tab').first().click();
  await fileRow(page, name).dblclick();
  await documentTab(page, name).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
}

async function openListed(page: Page, name: string): Promise<void> {
  await openArchive(page, name);
  await table(page).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
}

async function startExtraction(page: Page, name: string): Promise<void> {
  await openListed(page, name);
  await page.getByRole('button', { name: 'Extraer todo…' }).click();
  await dialog(page).getByRole('heading', { name: DIALOG_TITLE }).waitFor();
}

async function snapshot(page: Page, name: string): Promise<void> {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const html = await page.evaluate(() =>
    document.documentElement.outerHTML.replace(
      /<script[\s\S]*?<\/script>/g,
      '',
    ),
  );
  writeFileSync(
    join(SNAPSHOT_DIR, `${name}.html`),
    `<!doctype html>
${html}`,
  );
}

async function finishDialog(page: Page, button: string): Promise<void> {
  await dialog(page).getByRole('button', { name: button }).click();
  await dialog(page).waitFor({ state: 'detached' });
}

beforeAll(async () => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
  app = await launchExplorer(newConfigDir(manifest, keep));
  dialogs = trackDialogs(app.page).dialogs;
  writeArchives(folderPath());
  await showFolder(app.page, WC);
  await enterFolder(app.page, FOLDER);
}, SUITE_TIMEOUT_MS);

afterEach(async ({ task }) => {
  if (task.result?.state !== 'fail') return;
  const name = task.name.replace(/\W+/g, '-').slice(0, 60);
  await app.capture(`fallo-comprimidos-${name}`).catch(() => undefined);
});

afterAll(() => {
  app?.stop();
  keep.forEach(removeDir);
  stopFixtures(seedRoot);
  removeDir(seedRoot);
});

describe('comprimidos en la ventana real: lo hostil y lo roto, primero', () => {
  it(
    'un zip truncado ni siquiera se clasifica como comprimido: tarjeta binaria sin botón de extraer',
    async () => {
      await openArchive(app.page, 'roto.zip');
      const card = app.page.getByRole('article', { name: 'Archivo roto.zip' });
      await card.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await expect(card.innerText()).resolves.toContain('Archivo binario');
      expect(await app.page.getByText('Extraer todo…').count()).toBe(0);
      await closeDocument(app.page, 'roto.zip');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'los nombres con HTML o controles bidireccionales se ven como texto y no ejecutan nada',
    async () => {
      await openListed(app.page, 'nombres.zip');
      const listing = table(app.page);
      await expect(listing.innerText()).resolves.toContain(MARKUP_NAME);
      await expect(listing.innerText()).resolves.toContain(
        BIDI_NAME.replace(String.fromCharCode(0x202e), '‹U+202E›'),
      );
      expect(await listing.locator('img').count()).toBe(0);
      expect(dialogs).toEqual([]);
      await closeDocument(app.page, 'nombres.zip');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'un zip cifrado se lista, avisa y no permite extraer',
    async () => {
      await openListed(app.page, 'cifrado.zip');
      await app.page
        .getByText(/entradas cifradas/)
        .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      const extract = app.page.getByRole('button', { name: 'Extraer todo…' });
      expect(await extract.isDisabled()).toBe(true);
      await closeDocument(app.page, 'cifrado.zip');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('comprimidos en la ventana real: un archivo de cada formato', () => {
  it.each(FORMATS)(
    '%s se lista con su formato',
    async (name, format, entry) => {
      await openListed(app.page, name);
      await app.page
        .getByText(format)
        .first()
        .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      const text = await table(app.page).innerText();
      if (entry) expect(text).toContain(entry);
      expect(await table(app.page).getByRole('row').count()).toBeGreaterThan(1);
      await closeDocument(app.page, name);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'las entradas inseguras se marcan con su razón antes de extraer',
    async () => {
      await openListed(app.page, 'hostil.zip');
      const text = await table(app.page).innerText();
      expect(text).toContain('../escape.txt');
      expect(text).toContain('No se extrae: sube de carpeta');
      expect(text).toContain('No se extrae: nombre reservado de Windows');
      await snapshot(app.page, 'visor');
      await captureBothThemes(app, 'comprimidos-visor');
      await closeDocument(app.page, 'hostil.zip');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('comprimidos en la ventana real: extraer', () => {
  it(
    'extrae a una carpeta nueva, informa lo omitido, no escapa y queda sin versionar',
    async () => {
      await setTheme(app.page, 'light');
      await startExtraction(app.page, 'hostil.zip');
      await snapshot(app.page, 'dialogo-light');
      await app.capture('comprimidos-dialogo-light');
      await finishDialog(app.page, 'Cancelar');
      await setTheme(app.page, 'dark');
      await startExtraction(app.page, 'hostil.zip');
      await snapshot(app.page, 'dialogo-dark');
      await app.capture('comprimidos-dialogo-dark');
      await dialog(app.page).getByRole('button', { name: 'Extraer' }).click();
      await dialog(app.page)
        .getByText(/Se extrajeron/)
        .waitFor({
          timeout: VISIBLE_TIMEOUT_MS,
        });
      const result = await dialog(app.page).innerText();
      expect(result).toContain('2 archivos');
      expect(result).toContain('../escape.txt');
      expect(result).toContain('CON.txt');
      expect(readFileSync(folderPath('hostil/leeme.txt'), 'utf8')).toBe(
        'Hola desde un comprimido',
      );
      expect(existsSync(folderPath('hostil/docs/nota.txt'))).toBe(true);
      expect(existsSync(folderPath('escape.txt'))).toBe(false);
      expect(existsSync(join(manifest.wc_path, 'escape.txt'))).toBe(false);
      expect(existsSync(folderPath('hostil/CON.txt'))).toBe(false);
      await snapshot(app.page, 'resultado-dark');
      await app.capture('comprimidos-resultado-dark');
      await finishDialog(app.page, 'Abrir carpeta');
      await setTheme(app.page, 'light');
      await fileRow(app.page, 'leeme.txt').waitFor({
        timeout: VISIBLE_TIMEOUT_MS,
      });
      await expect
        .poll(
          async () =>
            (await fileRow(app.page, 'leeme.txt').getAttribute('aria-label')) ??
            '',
          { timeout: VISIBLE_TIMEOUT_MS },
        )
        .toContain('Sin versionar');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'extraer de nuevo no sobrescribe: crea la carpeta con sufijo',
    async () => {
      await startExtraction(app.page, 'hostil.zip');
      await dialog(app.page).getByRole('button', { name: 'Extraer' }).click();
      await dialog(app.page)
        .getByText(/Se extrajeron/)
        .waitFor({
          timeout: VISIBLE_TIMEOUT_MS,
        });
      await finishDialog(app.page, 'Cerrar');
      expect(existsSync(folderPath('hostil-2/leeme.txt'))).toBe(true);
      expect(existsSync(folderPath('hostil-3'))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'una bomba pide confirmación y, si se rechaza, no deja nada en disco',
    async () => {
      await startExtraction(app.page, 'bomba.tar.xz');
      const warning = dialog(app.page).getByRole('alert');
      await expect(warning.innerText()).resolves.toContain('sospechoso');
      await finishDialog(app.page, 'Cancelar');
      expect(existsSync(folderPath('bomba'))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'una bomba confirmada se puede cancelar a mitad y no deja nada en disco',
    async () => {
      await startExtraction(app.page, 'bomba.tar.xz');
      await dialog(app.page)
        .getByRole('button', { name: 'Extraer de todos modos' })
        .click();
      await dialog(app.page)
        .getByText(/archivos? · /)
        .waitFor({ timeout: CANCEL_WAIT_MS });
      await dialog(app.page)
        .getByRole('button', { name: 'Cancelar extracción' })
        .click();
      await dialog(app.page)
        .getByText('No quedó nada en el disco')
        .waitFor({ timeout: CANCEL_WAIT_MS });
      await finishDialog(app.page, 'Cerrar');
      expect(existsSync(folderPath('bomba'))).toBe(false);
      expect(existsSync(folderPath('bomba-2'))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});
