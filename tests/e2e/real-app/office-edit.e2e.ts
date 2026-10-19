import { chmodSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
import { setIpcFake } from './ipcGate';
import {
  DRAW_SETTLE_MS,
  FRAME_SELECTOR,
  LEGACY_DIR,
  MODIFIED_CHIP,
  OPEN_TIMEOUT_MS,
  READY_STAGE,
  SAVED_CHIP,
  closeAndWaitForRelease,
  copyFixture,
  generateOfficeFixtures,
  insertText,
  openOffice,
  readInside,
  readOfficeText,
  saveButton,
  seedFolder,
  waitForChip,
  webviewPrivateMegabytes,
} from './officeDriver';
import { enterFolder, showFolder } from './viewersDriver';

const WC = 'wc';
const FOLDER = 'zona-edicion';
const SUITE_TIMEOUT_MS = 600_000;
const TEST_TIMEOUT_MS = 240_000;
const CYCLE_TIMEOUT_MS = 900_000;
const CYCLES = 10;
const RECYCLE_LIMIT_MB = 2.5 * 1024;
const GROWTH_LIMIT_MB = 700;
const EXTERNAL_TEXT = 'Docx con macro VBA';

interface Source {
  name: string;
  from: string;
  isLegacy: boolean;
}

const GENERATED = [
  'documento.docx',
  'hoja.xlsx',
  'presentacion.pptx',
  'documento.odt',
  'hoja.ods',
  'presentacion.odp',
];
const SCENARIO_FILES = [
  'ctrl-s.docx',
  'conflicto-a.docx',
  'conflicto-b.docx',
  'ocupada.docx',
  'solo-lectura.docx',
  'cierre.docx',
  'persiste.docx',
  'cambio-a.docx',
  'cambio-b.xlsx',
  'cambio-c.docx',
  'ciclo.docx',
];

const FORMAT_CASES: [string, boolean][] = [
  ...GENERATED.map((name): [string, boolean] => [name, false]),
  ['documento.doc', true],
];

let manifest: FixtureManifest;
let seedRoot: string;
let app: AppSession;
let generatedDir: string;
let folderPath: string;
const keep: string[] = [];
const consoleLog: string[] = [];

function diskPath(name: string): string {
  return join(folderPath, name);
}

function sources(): Source[] {
  const generated = GENERATED.map((name) => ({
    name,
    from: join(generatedDir, name),
    isLegacy: false,
  }));
  return [
    ...generated,
    {
      name: 'documento.doc',
      from: join(LEGACY_DIR, 'documento.doc'),
      isLegacy: true,
    },
  ];
}

function seedEverything(): void {
  folderPath = seedFolder(manifest, FOLDER);
  for (const source of sources()) {
    copyFixture(source.from, folderPath, source.name);
  }
  for (const name of SCENARIO_FILES) {
    const base = name.endsWith('.xlsx') ? 'hoja.xlsx' : 'documento.docx';
    copyFixture(join(generatedDir, base), folderPath, name);
  }
}

async function clickSave(page: Page): Promise<void> {
  await saveButton(page).click();
}

async function answer(page: Page, label: string | RegExp): Promise<void> {
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: label })
    .click();
}

async function dialogTitle(page: Page, title: string): Promise<void> {
  await page
    .getByRole('alertdialog')
    .getByRole('heading', { name: title })
    .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
}

async function editAndWait(page: Page, text: string): Promise<void> {
  await insertText(page, text);
  await waitForChip(page, MODIFIED_CHIP);
}

function externalOverwrite(name: string): void {
  copyFileSync(join(generatedDir, 'macro.docx'), diskPath(name));
}

beforeAll(async () => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
  generatedDir = generateOfficeFixtures(keep);
  seedEverything();
  app = await launchExplorer(newConfigDir(manifest, keep));
  app.page.on('console', (message) => consoleLog.push(message.text()));
  app.page.on('pageerror', (error) =>
    consoleLog.push(`PAGEERROR ${error.message}`),
  );
  await showFolder(app.page, WC);
  await enterFolder(app.page, FOLDER);
}, SUITE_TIMEOUT_MS);

afterEach(async ({ task }) => {
  if (task.result?.state !== 'fail') return;
  const name = task.name.replace(/\W+/g, '-').slice(0, 60);
  await app.capture(`fallo-${name}`).catch(() => undefined);
  console.log(
    'CONSOLA',
    JSON.stringify(
      consoleLog.filter((line) => !line.includes('QObject')).slice(-12),
    ),
  );
});

afterAll(() => {
  app?.stop();
  keep.forEach(removeDir);
  stopFixtures(seedRoot);
  removeDir(seedRoot);
});

describe('edición de Office en la ventana real: el ciclo completo por formato', () => {
  it.each(FORMAT_CASES)(
    '%s: abrir, editar, guardar, cerrar, reabrir y leer con un lector independiente',
    async (name, isLegacy) => {
      const marker = `MARCA${name.replace(/\W/g, '')}`;
      await openOffice(app, name);
      await editAndWait(app.page, marker);
      await clickSave(app.page);
      if (isLegacy) await answer(app.page, 'Guardar de todos modos');
      await waitForChip(app.page, SAVED_CHIP);
      expect(readOfficeText(diskPath(name))).toContain(marker);
      await closeAndWaitForRelease(app, name);
      await openOffice(app, name);
      expect(await readInside(app.page)).toContain(marker);
      await closeAndWaitForRelease(app, name);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('edición de Office en la ventana real: guardar y conflictos', () => {
  it(
    'Ctrl+S dentro de ZetaOffice llega a disco y el documento no queda «guardado» sin haber llegado',
    async () => {
      const marker = 'MARCACTRLS';
      await openOffice(app, 'ctrl-s.docx');
      await editAndWait(app.page, marker);
      const box = await app.page.locator(FRAME_SELECTOR).boundingBox();
      await app.page.mouse.click(
        box!.x + box!.width / 2,
        box!.y + box!.height / 2,
      );
      await app.page.keyboard.press('Control+KeyS');
      await waitForChip(app.page, SAVED_CHIP);
      expect(readOfficeText(diskPath('ctrl-s.docx'))).toContain(marker);
      await closeAndWaitForRelease(app, 'ctrl-s.docx');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'un cambio externo pregunta; cancelar no pierde nada y sobrescribir guarda encima',
    async () => {
      const marker = 'MARCASOBRE';
      const name = 'conflicto-a.docx';
      await openOffice(app, name);
      await editAndWait(app.page, marker);
      externalOverwrite(name);
      await clickSave(app.page);
      await dialogTitle(app.page, 'El archivo cambió en el disco');
      await answer(app.page, 'Cancelar');
      await waitForChip(app.page, MODIFIED_CHIP);
      expect(readOfficeText(diskPath(name))).toContain(EXTERNAL_TEXT);
      expect(readOfficeText(diskPath(name))).not.toContain(marker);
      await clickSave(app.page);
      await answer(app.page, /Sobrescribir/);
      await waitForChip(app.page, SAVED_CHIP);
      expect(readOfficeText(diskPath(name))).toContain(marker);
      await closeAndWaitForRelease(app, name);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'un cambio externo y «Recargar» descarta lo escrito y muestra lo que hay en disco',
    async () => {
      const marker = 'MARCARECARGA';
      const name = 'conflicto-b.docx';
      await openOffice(app, name);
      await editAndWait(app.page, marker);
      externalOverwrite(name);
      await clickSave(app.page);
      await answer(app.page, /Recargar/);
      await app.page.locator(READY_STAGE).waitFor({ timeout: OPEN_TIMEOUT_MS });
      await app.page.waitForTimeout(DRAW_SETTLE_MS);
      await waitForChip(app.page, SAVED_CHIP);
      const shown = await readInside(app.page);
      expect(shown).toContain(EXTERNAL_TEXT);
      expect(shown).not.toContain(marker);
      expect(readOfficeText(diskPath(name))).not.toContain(marker);
      await closeAndWaitForRelease(app, name);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'una copia de trabajo ocupada avisa, no pierde los cambios y se puede reintentar',
    async () => {
      const marker = 'MARCAOCUPADA';
      const name = 'ocupada.docx';
      const before = readFileSync(diskPath(name));
      await openOffice(app, name);
      await editAndWait(app.page, marker);
      await setIpcFake(app.page, 'fs_write_bytes', {
        isError: true,
        body: {
          kind: 'working_copy_busy',
          message: 'ocupada',
          codes: [],
          detail: null,
        },
      });
      await clickSave(app.page);
      await app.page
        .getByText('La copia de trabajo está ocupada')
        .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await waitForChip(app.page, MODIFIED_CHIP);
      expect(readFileSync(diskPath(name))).toEqual(before);
      await setIpcFake(app.page, 'fs_write_bytes', null);
      await app.page.getByRole('button', { name: 'Reintentar' }).click();
      await waitForChip(app.page, SAVED_CHIP);
      expect(readOfficeText(diskPath(name))).toContain(marker);
      await closeAndWaitForRelease(app, name);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'un archivo de solo lectura no se pisa y avisa; al quitarle el atributo se guarda',
    async () => {
      const marker = 'MARCASOLOLECTURA';
      const name = 'solo-lectura.docx';
      chmodSync(diskPath(name), 0o444);
      const before = readFileSync(diskPath(name));
      await openOffice(app, name);
      await editAndWait(app.page, marker);
      await clickSave(app.page);
      await app.page
        .getByRole('alert')
        .getByText('solo lectura')
        .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await app.page
        .locator('.office-viewer__chip', { hasText: 'Solo lectura' })
        .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      expect(readFileSync(diskPath(name))).toEqual(before);
      chmodSync(diskPath(name), 0o666);
      await app.page
        .getByRole('button', { name: 'Reintentar guardado' })
        .click();
      await waitForChip(app.page, SAVED_CHIP);
      expect(readOfficeText(diskPath(name))).toContain(marker);
      await closeAndWaitForRelease(app, name);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('edición de Office en la ventana real: no perder datos al cerrar ni cambiar', () => {
  it(
    'cerrar la pestaña con cambios: cancelar no pierde nada y confirmar descarta',
    async () => {
      const marker = 'MARCACIERRE';
      const name = 'cierre.docx';
      await openOffice(app, name);
      await editAndWait(app.page, marker);
      const close = app.page.getByRole('button', {
        name: `Cerrar pestaña ${name}`,
      });
      await close.click();
      await dialogTitle(app.page, 'Cambios sin guardar');
      await answer(app.page, 'Volver');
      await documentTab(app.page, name).waitFor();
      await waitForChip(app.page, MODIFIED_CHIP);
      expect(await readInside(app.page)).toContain(marker);
      await close.click();
      await answer(app.page, 'Cerrar sin guardar');
      await documentTab(app.page, name).waitFor({ state: 'detached' });
      await app.page.locator(FRAME_SELECTOR).waitFor({
        state: 'detached',
        timeout: VISIBLE_TIMEOUT_MS,
      });
      expect(readOfficeText(diskPath(name))).not.toContain(marker);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'ir al explorador y volver conserva el documento con sus cambios sin recargar',
    async () => {
      const marker = 'MARCAPERSISTE';
      const name = 'persiste.docx';
      await openOffice(app, name);
      await editAndWait(app.page, marker);
      await app.page.getByRole('tab').first().click();
      expect(await app.page.locator(FRAME_SELECTOR).count()).toBe(1);
      await documentTab(app.page, name).click();
      await waitForChip(app.page, MODIFIED_CHIP);
      const box = await app.page.locator(FRAME_SELECTOR).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThan(0);
      expect(await readInside(app.page)).toContain(marker);
      await clickSave(app.page);
      await waitForChip(app.page, SAVED_CHIP);
      expect(readOfficeText(diskPath(name))).toContain(marker);
      await closeAndWaitForRelease(app, name);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'abrir otro Office con cambios pendientes: cancelar vuelve al primero; descartar lo cierra',
    async () => {
      const marker = 'MARCACAMBIOA';
      await openOffice(app, 'cambio-a.docx');
      await editAndWait(app.page, marker);
      await app.page.getByRole('tab').first().click();
      await fileRow(app.page, 'cambio-b.xlsx').dblclick();
      await dialogTitle(app.page, 'Hay un documento de Office con cambios');
      await answer(app.page, 'Cancelar');
      await app.page
        .locator('[role="tab"][aria-selected="true"]', {
          hasText: 'cambio-a.docx',
        })
        .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await waitForChip(app.page, MODIFIED_CHIP);
      expect(await readInside(app.page)).toContain(marker);
      await app.page.getByRole('tab').first().click();
      await fileRow(app.page, 'cambio-b.xlsx').dblclick();
      await answer(app.page, 'Descartar los cambios');
      await app.page.locator(READY_STAGE).waitFor({ timeout: OPEN_TIMEOUT_MS });
      expect(readOfficeText(diskPath('cambio-a.docx'))).not.toContain(marker);
      await closeAndWaitForRelease(app, 'cambio-b.xlsx');
      await closeAndWaitForRelease(app, 'cambio-a.docx').catch(() => undefined);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'abrir otro Office con cambios pendientes y «Guardar y continuar» guarda el primero',
    async () => {
      const marker = 'MARCACAMBIOC';
      await openOffice(app, 'cambio-c.docx');
      await editAndWait(app.page, marker);
      await app.page.getByRole('tab').first().click();
      await fileRow(app.page, 'cambio-b.xlsx').dblclick();
      await answer(app.page, 'Guardar y continuar');
      await app.page.locator(READY_STAGE).waitFor({ timeout: OPEN_TIMEOUT_MS });
      expect(readOfficeText(diskPath('cambio-c.docx'))).toContain(marker);
      await closeAndWaitForRelease(app, 'cambio-b.xlsx');
      await closeAndWaitForRelease(app, 'cambio-c.docx').catch(() => undefined);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('edición de Office en la ventana real: la memoria no se acumula', () => {
  it(
    `${CYCLES} ciclos de abrir y cerrar no superan el tope ni crecen sin límite`,
    async () => {
      const readings: number[] = [];
      for (let cycle = 0; cycle < CYCLES; cycle += 1) {
        await openOffice(app, 'ciclo.docx');
        await closeAndWaitForRelease(app, 'ciclo.docx');
        readings.push(webviewPrivateMegabytes());
      }
      expect(Math.max(...readings)).toBeLessThanOrEqual(RECYCLE_LIMIT_MB);
      expect(readings[readings.length - 1]).toBeLessThanOrEqual(
        readings[0] + GROWTH_LIMIT_MB,
      );
    },
    CYCLE_TIMEOUT_MS,
  );
});

describe('edición de Office en la ventana real: sin red ni violaciones', () => {
  it('ni una petición externa ni una violación de CSP en todo el recorrido', async () => {
    expect(app.externalRequests).toEqual([]);
    expect(await app.cspViolations()).toEqual([]);
  });
});
