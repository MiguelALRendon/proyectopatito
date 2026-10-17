import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MODIFIED,
  SAVED,
  SCRATCH_DIR,
  VISIBLE_TIMEOUT_MS,
  WC_NAME,
  captureBothThemes,
  captureDialogBothThemes,
  documentTab,
  editorText,
  expectCleanSession,
  fileRow,
  launchExplorer,
  newConfigDir,
  noticeBanner,
  openFile,
  openFromFolderTab,
  removeDir,
  saveButton,
  scratchPath,
  typeAtEnd,
  waitForChip,
  writeScratch,
} from './editorDriver';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import { type AppSession } from './harness';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);
const NEEDS_LOCK_FILE = 'requiere-bloqueo.txt';
const CLEAN_WC_FILE = 'lf.txt';
const APPENDED = 'x';
const SETTLE_MS = 750;
const BLOCKED_KEY = 'Z';

interface ByteCase {
  name: string;
  original: Buffer;
  appended: Buffer;
}

function utf16Be(text: string): Buffer {
  return Buffer.from(text, 'utf16le').swap16();
}

const BYTE_CASES: ByteCase[] = [
  {
    name: 'plano-lf.txt',
    original: Buffer.from('uno\ndos\n'),
    appended: Buffer.from(APPENDED),
  },
  {
    name: 'plano-crlf.txt',
    original: Buffer.from('uno\r\ndos\r\n'),
    appended: Buffer.from(APPENDED),
  },
  {
    name: 'bom-crlf.txt',
    original: Buffer.concat([UTF8_BOM, Buffer.from('uno\r\ndos\r\n')]),
    appended: Buffer.from(APPENDED),
  },
  {
    name: 'bom-lf.txt',
    original: Buffer.concat([UTF8_BOM, Buffer.from('uno\ndos\n')]),
    appended: Buffer.from(APPENDED),
  },
  {
    name: 'utf16-le.txt',
    original: Buffer.concat([
      UTF16_LE_BOM,
      Buffer.from('uno\r\ndos\r\n', 'utf16le'),
    ]),
    appended: Buffer.from(APPENDED, 'utf16le'),
  },
  {
    name: 'utf16-be.txt',
    original: Buffer.concat([UTF16_BE_BOM, utf16Be('uno\r\ndos\r\n')]),
    appended: utf16Be(APPENDED),
  },
];

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
  removeDir(scratchPath(manifest));
});

afterAll(() => {
  scratchDirs.forEach(removeDir);
  stopFixtures(seedRoot);
});

async function launch(): Promise<AppSession> {
  session = await launchExplorer(newConfigDir(manifest, scratchDirs));
  return session;
}

function wcFile(name: string): string {
  return join(manifest.wc_path, name);
}

function onDisk(path: string): Buffer {
  return readFileSync(path);
}

async function saveWithShortcut(page: Page): Promise<void> {
  await page.keyboard.press('Control+S');
  await waitForChip(page, SAVED);
}

async function waitForAlert(page: Page, text: string): Promise<void> {
  await noticeBanner(page, text).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
}

describe('editar y guardar sobre la ventana real', () => {
  it('Ctrl+S escribe en disco, el distintivo del archivo pasa a Modificado en el explorador y el editor queda como Guardado', async () => {
    const app = await launch();
    const { page } = app;
    const path = wcFile(CLEAN_WC_FILE);
    const before = onDisk(path);
    await openFile(page, WC_NAME, CLEAN_WC_FILE);
    await waitForChip(page, SAVED);
    expect(await saveButton(page).isDisabled()).toBe(true);

    await typeAtEnd(page, APPENDED);
    await waitForChip(page, MODIFIED);
    expect(await saveButton(page).isDisabled()).toBe(false);
    await documentTab(page, CLEAN_WC_FILE).waitFor();
    expect(
      await page
        .getByRole('tab', { name: `${CLEAN_WC_FILE} (cambios sin guardar)` })
        .count(),
    ).toBe(1);
    expect(onDisk(path)).toEqual(before);
    await captureBothThemes(app, 'i12-editor-con-cambios');

    await saveWithShortcut(page);
    expect(onDisk(path)).toEqual(
      Buffer.concat([before, Buffer.from(APPENDED)]),
    );
    expect(await saveButton(page).isDisabled()).toBe(true);
    expect(
      await page.locator('[aria-label="Estado del documento"]').innerText(),
    ).toContain(SAVED);
    await captureBothThemes(app, 'i12-editor-guardado');

    await page.getByRole('tab', { name: WC_NAME, exact: true }).click();
    const badge = fileRow(page, CLEAN_WC_FILE).locator(
      '.svn-badge[data-state="modified"]',
    );
    await badge.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    expect((await badge.innerText()).trim()).toBe(MODIFIED);
    await expectCleanSession(app);
  });

  it('el botón Guardar escribe y deja el editor limpio', async () => {
    writeScratch(manifest, 'boton.txt', 'uno\n');
    const app = await launch();
    const { page } = app;
    await openFile(page, SCRATCH_DIR, 'boton.txt');
    await typeAtEnd(page, APPENDED);
    await waitForChip(page, MODIFIED);

    await saveButton(page).click();
    await waitForChip(page, SAVED);

    expect(onDisk(scratchPath(manifest, 'boton.txt')).toString()).toBe(
      `uno\n${APPENDED}`,
    );
    await expectCleanSession(app);
  });

  it('la búsqueda y el reemplazo de Monaco funcionan en el editor editable', async () => {
    writeScratch(manifest, 'buscar.txt', 'gato\ngato\n');
    const app = await launch();
    const { page } = app;
    await openFile(page, SCRATCH_DIR, 'buscar.txt');
    await page.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('Control+H');
    const widget = page.locator('.find-widget.visible');
    await widget.locator('.replace-part').waitFor();
    await page.keyboard.type('gato');
    await widget.locator('.replace-part textarea').fill('perro');
    await page.keyboard.press('Control+Alt+Enter');
    await waitForChip(page, MODIFIED);
    await page.keyboard.press('Escape');
    await saveWithShortcut(page);

    expect(onDisk(scratchPath(manifest, 'buscar.txt')).toString()).toBe(
      'perro\nperro\n',
    );
    await expectCleanSession(app);
  });
});

describe('se conservan los bytes del archivo', () => {
  it('BOM, UTF-16 y final de línea sobreviven al guardado byte a byte', async () => {
    BYTE_CASES.forEach((item) =>
      writeScratch(manifest, item.name, item.original),
    );
    const app = await launch();
    const { page } = app;

    for (const [index, item] of BYTE_CASES.entries()) {
      if (index === 0) await openFile(page, SCRATCH_DIR, item.name);
      else await openFromFolderTab(page, SCRATCH_DIR, item.name);
      await typeAtEnd(page, APPENDED);
      await saveWithShortcut(page);
      const expected = Buffer.concat([item.original, item.appended]);
      expect(onDisk(scratchPath(manifest, item.name)), item.name).toEqual(
        expected,
      );
    }
    await expectCleanSession(app);
  });

  it('Ctrl+S sin cambios no reescribe el archivo', async () => {
    const original = BYTE_CASES[4].original;
    const path = writeScratch(manifest, 'quieto.txt', original);
    const modifiedBefore = statSync(path).mtimeMs;
    const app = await launch();
    await openFile(app.page, SCRATCH_DIR, 'quieto.txt');
    await app.page.locator('.monaco-editor .view-lines').click();
    await app.page.keyboard.press('Control+S');
    await app.page.waitForTimeout(SETTLE_MS);
    expect(onDisk(path)).toEqual(original);
    expect(statSync(path).mtimeMs).toBe(modifiedBefore);
  });
});

describe('archivo de solo lectura', () => {
  it('svn:needs-lock avisa, deja el editor en solo lectura y no escribe', async () => {
    const path = wcFile(NEEDS_LOCK_FILE);
    expect(statSync(path).mode & 0o200).toBe(0);
    const before = onDisk(path);
    const app = await launch();
    const { page } = app;
    await openFile(page, WC_NAME, NEEDS_LOCK_FILE);
    await typeAtEnd(page, APPENDED);
    await waitForChip(page, MODIFIED);

    await page.keyboard.press('Control+S');
    await waitForAlert(page, 'solo lectura');

    expect(onDisk(path)).toEqual(before);
    expect(await page.getByText('Solo lectura', { exact: true }).count()).toBe(
      1,
    );
    await page.locator('.monaco-editor .view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(BLOCKED_KEY);
    expect(await editorText(page)).not.toContain(BLOCKED_KEY);
    expect(await editorText(page)).toContain(APPENDED);
    await captureBothThemes(app, 'i12-aviso-solo-lectura');

    await page.getByRole('button', { name: 'Reintentar guardado' }).click();
    await waitForAlert(page, 'solo lectura');
    expect(onDisk(path)).toEqual(before);
    await expectCleanSession(app);
  });

  it('un archivo que deja de ser de solo lectura se guarda al reintentar', async () => {
    const path = writeScratch(manifest, 'bloqueado.txt', 'uno\n');
    chmodSync(path, 0o444);
    const app = await launch();
    const { page } = app;
    await openFile(page, SCRATCH_DIR, 'bloqueado.txt');
    await typeAtEnd(page, APPENDED);
    await page.keyboard.press('Control+S');
    await waitForAlert(page, 'solo lectura');

    chmodSync(path, 0o666);
    await page.getByRole('button', { name: 'Reintentar guardado' }).click();
    await waitForChip(page, SAVED);

    expect(onDisk(path).toString()).toBe(`uno\n${APPENDED}`);
    expect(await page.locator('.banner[role="alert"]').count()).toBe(0);
  });
});

describe('final de línea mixto', () => {
  const MIXED = 'uno\r\ndos\ntres\n';

  it('avisa antes de normalizar: cancelar no escribe y se puede elegir CRLF', async () => {
    const path = writeScratch(manifest, 'mixto.txt', MIXED);
    const app = await launch();
    const { page } = app;
    await openFile(page, SCRATCH_DIR, 'mixto.txt');
    await typeAtEnd(page, APPENDED);
    await waitForChip(page, MODIFIED);

    await captureDialogBothThemes(app, {
      name: 'i12-aviso-eol-mixto',
      open: () => saveButton(page).click(),
      dismiss: 'Cancelar',
    });
    expect(onDisk(path).toString()).toBe(MIXED);
    await waitForChip(page, MODIFIED);

    await saveButton(page).click();
    const dialog = page.getByRole('alertdialog');
    expect(await dialog.innerText()).toContain('predomina LF');
    await dialog.getByRole('button', { name: 'Usar CRLF' }).click();
    await waitForChip(page, SAVED);

    expect(onDisk(path).toString()).toBe(`uno\r\ndos\r\ntres\r\n${APPENDED}`);
    await typeAtEnd(page, APPENDED);
    await saveWithShortcut(page);
    expect(await page.getByRole('alertdialog').count()).toBe(0);
    expect(onDisk(path).toString()).toBe(
      `uno\r\ndos\r\ntres\r\n${APPENDED}${APPENDED}`,
    );
    await expectCleanSession(app);
  });

  it('conservar el dominante unifica con el final de línea que predomina', async () => {
    const path = writeScratch(manifest, 'mixto-dominante.txt', MIXED);
    const app = await launch();
    const { page } = app;
    await openFile(page, SCRATCH_DIR, 'mixto-dominante.txt');
    await typeAtEnd(page, APPENDED);

    await saveButton(page).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Conservar el dominante (LF)' })
      .click();
    await waitForChip(page, SAVED);

    expect(onDisk(path).toString()).toBe(`uno\ndos\ntres\n${APPENDED}`);
  });
});

describe('cambio externo mientras el archivo está abierto', () => {
  it('muestra el diálogo y cada opción funciona: cancelar, recargar y sobrescribir', async () => {
    const path = writeScratch(manifest, 'externo.txt', 'original\n');
    const app = await launch();
    const { page } = app;
    await openFile(page, SCRATCH_DIR, 'externo.txt');
    await typeAtEnd(page, 'mio');
    await waitForChip(page, MODIFIED);
    writeFileSync(path, 'externo uno\n');

    await captureDialogBothThemes(app, {
      name: 'i12-dialogo-conflicto',
      open: () => saveButton(page).click(),
      dismiss: 'Cancelar',
    });
    expect(onDisk(path).toString()).toBe('externo uno\n');
    expect(await editorText(page)).toContain('mio');
    await waitForChip(page, MODIFIED);

    await saveButton(page).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Recargar/ })
      .click();
    await waitForChip(page, SAVED);
    await expect.poll(() => editorText(page)).toContain('externo uno');
    expect(await editorText(page)).not.toContain('mio');
    expect(onDisk(path).toString()).toBe('externo uno\n');

    await typeAtEnd(page, 'z');
    await waitForChip(page, MODIFIED);
    writeFileSync(path, 'externo dos\n');
    await saveButton(page).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Sobrescribir/ })
      .click();
    await waitForChip(page, SAVED);

    expect(onDisk(path).toString()).toBe('externo uno\nz');
    await expectCleanSession(app);
  });

  it('con el diálogo abierto Ctrl+S no guarda y Escape equivale a Cancelar sin perder nada', async () => {
    const path = writeScratch(manifest, 'externo-escape.txt', 'original\n');
    const app = await launch();
    const { page } = app;
    await openFile(page, SCRATCH_DIR, 'externo-escape.txt');
    await typeAtEnd(page, 'mio');
    await waitForChip(page, MODIFIED);
    writeFileSync(path, 'externo uno\n');

    await saveButton(page).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    await page.keyboard.press('Control+S');
    await page.waitForTimeout(SETTLE_MS);
    expect(await dialog.count()).toBe(1);
    expect(onDisk(path).toString()).toBe('externo uno\n');

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await page.waitForTimeout(SETTLE_MS);

    expect(onDisk(path).toString()).toBe('externo uno\n');
    expect(await editorText(page)).toContain('mio');
    await waitForChip(page, MODIFIED);
  });

  it('un archivo que pasó a binario por fuera no se pisa sin preguntar', async () => {
    const path = writeScratch(manifest, 'cambia.txt', 'texto\n');
    const app = await launch();
    const { page } = app;
    await openFile(page, SCRATCH_DIR, 'cambia.txt');
    await typeAtEnd(page, APPENDED);
    writeFileSync(path, Buffer.from([0x00, 0x01, 0x02, 0xff]));

    await saveButton(page).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    await dialog.getByRole('button', { name: 'Cancelar' }).click();

    expect(onDisk(path)).toEqual(Buffer.from([0x00, 0x01, 0x02, 0xff]));
    await waitForChip(page, MODIFIED);
  });
});

describe('cerrar una pestaña con cambios', () => {
  it('pide confirmación, cancelar no pierde nada, también tras cambiar de pestaña, y confirmar descarta', async () => {
    const path = writeScratch(manifest, 'cierre.txt', 'uno\n');
    const app = await launch();
    const { page } = app;
    await openFile(page, SCRATCH_DIR, 'cierre.txt');
    await typeAtEnd(page, 'cambio');
    await waitForChip(page, MODIFIED);
    const closeButton = page.getByRole('button', {
      name: 'Cerrar pestaña cierre.txt',
    });

    await captureDialogBothThemes(app, {
      name: 'i12-confirmacion-cierre-pestana',
      open: () => closeButton.click(),
      dismiss: 'Volver',
    });
    await documentTab(page, 'cierre.txt').waitFor();
    expect(await editorText(page)).toContain('cambio');

    await page.getByRole('tab', { name: SCRATCH_DIR, exact: true }).click();
    await documentTab(page, 'cierre.txt').click();
    await waitForChip(page, MODIFIED);
    await expect.poll(() => editorText(page)).toContain('cambio');

    await closeButton.click();
    const dialog = page.getByRole('alertdialog');
    expect(await dialog.innerText()).toContain('cambios sin guardar');
    await dialog.getByRole('button', { name: 'Cerrar sin guardar' }).click();
    await documentTab(page, 'cierre.txt').waitFor({ state: 'detached' });
    expect(onDisk(path).toString()).toBe('uno\n');
    await expectCleanSession(app);
  });

  it('una pestaña sin cambios se cierra sin preguntar y guardar antes evita la pregunta', async () => {
    writeScratch(manifest, 'limpio.txt', 'uno\n');
    writeScratch(manifest, 'guardado.txt', 'uno\n');
    const app = await launch();
    const { page } = app;
    await openFile(page, SCRATCH_DIR, 'limpio.txt');
    await page
      .getByRole('button', { name: 'Cerrar pestaña limpio.txt' })
      .click();
    await documentTab(page, 'limpio.txt').waitFor({ state: 'detached' });
    expect(await page.getByRole('alertdialog').count()).toBe(0);

    await openFromFolderTab(page, SCRATCH_DIR, 'guardado.txt');
    await typeAtEnd(page, APPENDED);
    await saveWithShortcut(page);
    await page
      .getByRole('button', { name: 'Cerrar pestaña guardado.txt' })
      .click();
    await documentTab(page, 'guardado.txt').waitFor({ state: 'detached' });
    expect(await page.getByRole('alertdialog').count()).toBe(0);
  });
});
