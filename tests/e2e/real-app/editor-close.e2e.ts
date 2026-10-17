import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MODIFIED,
  SAVED,
  SCRATCH_DIR,
  VISIBLE_TIMEOUT_MS,
  WC_NAME,
  captureDialogBothThemes,
  documentTab,
  expectCleanSession,
  launchExplorer,
  newConfigDir,
  noticeBanner,
  openFile,
  openFromFolderTab,
  removeDir,
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
import { HOLD_KEEPALIVE_MS, type AppSession } from './harness';
import { ipcCalls, setIpcRule } from './ipcGate';

const EXIT_MARGIN_MS = 15_000;
const SETTLE_MS = 750;
const CONFIRM_COMMAND = 'app_confirm_close';
const CANCEL_COMMAND = 'app_cancel_close';
const HOLD_COMMAND = 'app_hold_close';
const EXTERNAL_TEXT = 'cambio externo\n';
const MIN_PINGS_WHILE_WAITING = 5;
const NEEDS_LOCK_FILE = 'requiere-bloqueo.txt';
const APPENDED = 'x';

let session: AppSession | undefined;
let manifest: FixtureManifest;
let seedRoot: string;
let configDir = '';
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

async function launch(scratchNames: string[] = []): Promise<AppSession> {
  scratchNames.forEach((name) => writeScratch(manifest, name, 'uno\n'));
  configDir = newConfigDir(manifest, scratchDirs);
  session = await launchExplorer(configDir);
  return session;
}

function pause(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function callsTo(page: Page, command: string): Promise<number> {
  const calls = await ipcCalls(page);
  return calls.filter((call) => call.command === command).length;
}

async function waitForCalls(
  page: Page,
  command: string,
  expected: number,
): Promise<void> {
  await expect
    .poll(() => callsTo(page, command), { timeout: VISIBLE_TIMEOUT_MS })
    .toBe(expected);
}

async function editScratch(
  app: AppSession,
  name: string,
  isFirst = true,
): Promise<string> {
  const path = scratchPath(manifest, name);
  if (isFirst) await openFile(app.page, SCRATCH_DIR, name);
  else await openFromFolderTab(app.page, SCRATCH_DIR, name);
  await typeAtEnd(app.page, APPENDED);
  await waitForChip(app.page, MODIFIED);
  return path;
}

function requestClose(app: AppSession): Promise<void> {
  app.closeMainWindow();
  return app.page
    .getByRole('alertdialog')
    .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
}

function confirmationButton(page: Page, name: string) {
  return page.getByRole('alertdialog').getByRole('button', { name });
}

function dialogOf(page: Page) {
  return page.getByRole('alertdialog');
}

function persistedTabTitles(): string[] {
  const config = JSON.parse(
    readFileSync(join(configDir, 'config.json'), 'utf8'),
  ) as { ui?: { tabs?: { title: string }[] } };
  return (config.ui?.tabs ?? []).map((tab) => tab.title);
}

describe('cierre de la ventana real con un documento sucio', () => {
  it('cancelar mantiene el proceso vivo y los cambios, y no confirma el cierre', async () => {
    const app = await launch(['ventana-cancelar.txt']);
    const { page } = app;
    await editScratch(app, 'ventana-cancelar.txt');

    let cancelled = 0;
    await captureDialogBothThemes(app, {
      name: 'i12-confirmacion-cierre-ventana',
      open: async () => {
        await waitForCalls(page, CANCEL_COMMAND, cancelled);
        await pause(SETTLE_MS);
        cancelled += 1;
        await requestClose(app);
      },
      dismiss: 'Cancelar',
    });
    await waitForCalls(page, CANCEL_COMMAND, cancelled);
    await pause(SETTLE_MS);

    expect(app.isRunning()).toBe(true);
    expect(await callsTo(page, CONFIRM_COMMAND)).toBe(0);
    await waitForChip(page, MODIFIED);
    expect(await page.locator('.monaco-editor').count()).toBe(1);
    await expectCleanSession(app);
  });

  it('el diálogo cuenta las pestañas sucias y el proceso sigue vivo mientras se decide', async () => {
    const app = await launch(['ventana-a.txt', 'ventana-b.txt']);
    await editScratch(app, 'ventana-a.txt');
    await editScratch(app, 'ventana-b.txt', false);

    await requestClose(app);
    const text = await app.page.getByRole('alertdialog').innerText();
    expect(text).toContain('2 pestañas tienen cambios sin guardar');
    await pause(SETTLE_MS);
    expect(app.isRunning()).toBe(true);
    expect(await callsTo(app.page, CONFIRM_COMMAND)).toBe(0);
    await confirmationButton(app.page, 'Cancelar').click();
    await waitForCalls(app.page, CANCEL_COMMAND, 1);
  });

  it('cerrar sin guardar termina el proceso sin escribir el archivo y deja la sesión de pestañas', async () => {
    const app = await launch(['ventana-descartar.txt']);
    const path = await editScratch(app, 'ventana-descartar.txt');

    await requestClose(app);
    await confirmationButton(app.page, 'Cerrar sin guardar').click();

    expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('uno\n');
    expect(persistedTabTitles()).toContain('ventana-descartar.txt');
  });

  it('guardar y cerrar escribe todas las pestañas sucias antes de terminar el proceso', async () => {
    const app = await launch([
      'ventana-guardar-a.txt',
      'ventana-guardar-b.txt',
    ]);
    const first = await editScratch(app, 'ventana-guardar-a.txt');
    const second = await editScratch(app, 'ventana-guardar-b.txt', false);

    await requestClose(app);
    await confirmationButton(app.page, 'Guardar y cerrar').click();

    expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
    expect(readFileSync(first, 'utf8')).toBe(`uno\n${APPENDED}`);
    expect(readFileSync(second, 'utf8')).toBe(`uno\n${APPENDED}`);
  });

  it('si no se puede guardar, el cierre se cancela, el proceso sigue vivo y se ve el motivo', async () => {
    const app = await launch();
    const { page } = app;
    const lockedPath = join(manifest.wc_path, NEEDS_LOCK_FILE);
    const before = readFileSync(lockedPath);
    await openFile(page, WC_NAME, NEEDS_LOCK_FILE);
    await typeAtEnd(page, APPENDED);
    await waitForChip(page, MODIFIED);

    await requestClose(app);
    await confirmationButton(page, 'Guardar y cerrar').click();
    await waitForCalls(page, CANCEL_COMMAND, 1);
    await noticeBanner(page, 'solo lectura').waitFor({
      timeout: VISIBLE_TIMEOUT_MS,
    });

    expect(app.isRunning()).toBe(true);
    expect(await callsTo(page, CONFIRM_COMMAND)).toBe(0);
    expect(readFileSync(lockedPath)).toEqual(before);
    await waitForChip(page, MODIFIED);

    await pause(SETTLE_MS);
    await requestClose(app);
    await confirmationButton(page, 'Cerrar sin guardar').click();
    expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
  });

  it('sin cambios sin guardar la ventana se cierra sin preguntar', async () => {
    const app = await launch(['ventana-limpia.txt']);
    await openFile(app.page, SCRATCH_DIR, 'ventana-limpia.txt');
    await waitForChip(app.page, SAVED);

    app.closeMainWindow();

    expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
  });
});

describe('el diálogo de cierre y el latido hacia Rust', () => {
  it('con el diálogo abierto Ctrl+S no guarda y Escape equivale a Cancelar sin perder nada', async () => {
    const app = await launch(['ventana-escape.txt']);
    const { page } = app;
    const path = await editScratch(app, 'ventana-escape.txt');

    await requestClose(app);
    await page.keyboard.press('Control+S');
    await pause(SETTLE_MS);
    expect(readFileSync(path, 'utf8')).toBe('uno\n');
    await dialogOf(page).waitFor({ timeout: VISIBLE_TIMEOUT_MS });

    await page.keyboard.press('Escape');
    await dialogOf(page).waitFor({ state: 'detached' });
    await waitForCalls(page, CANCEL_COMMAND, 1);
    await pause(SETTLE_MS);

    expect(app.isRunning()).toBe(true);
    expect(await callsTo(page, CONFIRM_COMMAND)).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe('uno\n');
    await waitForChip(page, MODIFIED);
  });

  it('mientras llegue el latido el diálogo sigue abierto y el proceso vivo mucho más allá del tiempo sin latido', async () => {
    const app = await launch(['ventana-latido.txt']);
    const { page } = app;
    await editScratch(app, 'ventana-latido.txt');

    await requestClose(app);
    await pause(HOLD_KEEPALIVE_MS * 2 + SETTLE_MS);

    expect(app.isRunning()).toBe(true);
    await dialogOf(page).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    expect(await callsTo(page, HOLD_COMMAND)).toBeGreaterThanOrEqual(
      MIN_PINGS_WHILE_WAITING,
    );
    expect(await callsTo(page, CONFIRM_COMMAND)).toBe(0);
    await confirmationButton(page, 'Cancelar').click();
    await waitForCalls(page, CANCEL_COMMAND, 1);
    await waitForChip(page, MODIFIED);
  });

  it('si la página deja de latir con el diálogo abierto Rust cierra la ventana en vez de quedar atrapada', async () => {
    const app = await launch(['ventana-sin-latido.txt']);
    const { page } = app;
    const path = await editScratch(app, 'ventana-sin-latido.txt');

    await requestClose(app);
    await setIpcRule(page, HOLD_COMMAND, 'swallow');

    expect(await app.waitForExit(HOLD_KEEPALIVE_MS + EXIT_MARGIN_MS)).toBe(
      true,
    );
    expect(readFileSync(path, 'utf8')).toBe('uno\n');
  });

  it('Guardar y cerrar con un cambio externo cancela el cierre, activa la pestaña en conflicto y conserva todo', async () => {
    const app = await launch([
      'ventana-conflicto-a.txt',
      'ventana-conflicto-b.txt',
    ]);
    const { page } = app;
    const first = await editScratch(app, 'ventana-conflicto-a.txt');
    const second = await editScratch(app, 'ventana-conflicto-b.txt', false);
    writeFileSync(first, EXTERNAL_TEXT);

    await requestClose(app);
    await confirmationButton(page, 'Guardar y cerrar').click();
    await waitForCalls(page, CANCEL_COMMAND, 1);
    await dialogOf(page).getByText('El archivo cambió en el disco').waitFor({
      timeout: VISIBLE_TIMEOUT_MS,
    });

    expect(
      await documentTab(page, 'ventana-conflicto-a.txt').getAttribute(
        'aria-selected',
      ),
    ).toBe('true');
    await confirmationButton(page, 'Cancelar').click();
    expect(app.isRunning()).toBe(true);
    expect(await callsTo(page, CONFIRM_COMMAND)).toBe(0);
    expect(readFileSync(first, 'utf8')).toBe(EXTERNAL_TEXT);
    expect(readFileSync(second, 'utf8')).toBe('uno\n');
    await waitForChip(page, MODIFIED);
  });
});
