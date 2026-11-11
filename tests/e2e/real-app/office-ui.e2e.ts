import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  VISIBLE_TIMEOUT_MS,
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
  FRAME_SELECTOR,
  closeAndWaitForRelease,
  copyFixture,
  dispatchInside,
  generateOfficeFixtures,
  innerWindow,
  openOffice,
  readInside,
  seedFolder,
} from './officeDriver';
import { resizeAppWindow } from './rawCdp';
import { enterFolder, showFolder } from './viewersDriver';

const WC = 'wc';
const FOLDER = 'zona-interfaz';
const SUITE_TIMEOUT_MS = 600_000;
const TEST_TIMEOUT_MS = 300_000;
const SETTLE_MS = 2_500;
const TOLERANCE_PX = 3;
const SIZES: [number, number][] = [
  [1000, 700],
  [1500, 900],
  [1280, 800],
];
const NAMES = ['redimensiona.docx', 'recorrido.docx', 'hoja.xlsx'];

const VETOED = [
  '.uno:Open',
  '.uno:OpenFromWriter',
  '.uno:OpenFromCalc',
  '.uno:OpenFromImpress',
  '.uno:OpenRemote',
  '.uno:SaveAs',
  '.uno:SaveAsTemplate',
  '.uno:SaveAsRemote',
  '.uno:ExportTo',
  '.uno:ExportToPDF',
  '.uno:ExportDirectToPDF',
  '.uno:SendMail',
  '.uno:Print',
  '.uno:PrintDefault',
  '.uno:NewDoc',
  '.uno:NewWindow',
  '.uno:CloseDoc',
  '.uno:CloseWin',
  '.uno:Quit',
  '.uno:Reload',
  '.uno:RecentFileList',
  '.uno:AddDirect',
  '.uno:AutoPilotMenu',
  '.uno:StartCenter',
  '.uno:OptionsTreeDialog',
  '.uno:About',
  '.uno:HelpIndex',
  '.uno:MacroOrganizer',
  '.uno:RunMacro',
  '.uno:OpenHyperlink',
  '.uno:InsertGraphic',
  '.uno:InsertDoc',
  'file:///tmp/x.odt',
  'private:factory/swriter',
  'macro:///Standard.Module1.Main',
  'vnd.sun.star.script:Standard.Module1.Main?language=Basic&location=document',
  'https://example.com/',
  'mailto:alguien@example.com',
];

let manifest: FixtureManifest;
let seedRoot: string;
let app: AppSession;
let generatedDir: string;
const keep: string[] = [];
const events: string[] = [];

beforeAll(async () => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
  generatedDir = generateOfficeFixtures(keep);
  const folder = seedFolder(manifest, FOLDER);
  for (const name of NAMES) {
    const base = name.endsWith('.xlsx') ? 'hoja.xlsx' : 'documento.docx';
    copyFixture(`${generatedDir}/${base}`, folder, name);
  }
  app = await launchExplorer(newConfigDir(manifest, keep));
  app.page.on('popup', () => events.push('popup'));
  app.page.on('download', () => events.push('download'));
  app.page.on('filechooser', () => events.push('filechooser'));
  await showFolder(app.page, WC);
  await enterFolder(app.page, FOLDER);
}, SUITE_TIMEOUT_MS);

afterEach(async ({ task }) => {
  if (task.result?.state !== 'fail') return;
  const name = task.name.replace(/\W+/g, '-').slice(0, 60);
  await app.capture(`fallo-ui-${name}`).catch(() => undefined);
});

afterAll(async () => {
  await resizeAppWindow(1280, 800).catch(() => undefined);
  app?.stop();
  keep.forEach(removeDir);
  stopFixtures(seedRoot);
  removeDir(seedRoot);
});

async function gaps(): Promise<{ width: number; height: number }> {
  const inner = await innerWindow(app.page);
  const box = await app.page.locator(FRAME_SELECTOR).boundingBox();
  expect(box).not.toBeNull();
  return {
    width: box!.width - inner.width,
    height: box!.height - inner.height,
  };
}

describe('interfaz de ZetaOffice en la ventana real: redimensionado', () => {
  it(
    'la ventana interna de LibreOffice sigue al contenedor al achicar y agrandar la ventana de la aplicación',
    async () => {
      await openOffice(app, 'redimensiona.docx');
      const measured = [await gaps()];
      await app.capture('office-ui-inicial');
      for (const [width, height] of SIZES) {
        await resizeAppWindow(width, height);
        await app.page.waitForTimeout(SETTLE_MS);
        measured.push(await gaps());
        await app.capture(`office-ui-${width}x${height}`);
      }
      for (const gap of measured) {
        expect(Math.abs(gap.width - measured[0].width)).toBeLessThanOrEqual(
          TOLERANCE_PX,
        );
        expect(Math.abs(gap.height - measured[0].height)).toBeLessThanOrEqual(
          TOLERANCE_PX,
        );
      }
      await closeAndWaitForRelease(app, 'redimensiona.docx');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('interfaz de ZetaOffice en la ventana real: recorrido de comandos vetados', () => {
  it(
    'ningún comando vetado abre un selector, una pantalla de inicio, una ventana ni deja el lienzo muerto',
    async () => {
      await openOffice(app, 'recorrido.docx');
      const frameBefore = await app.page.locator(FRAME_SELECTOR).count();
      for (const url of VETOED) {
        await dispatchInside(app.page, url);
        await app.page
          .locator(`[data-command="${url}"]`)
          .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      }
      await app.page.waitForTimeout(SETTLE_MS);
      expect(events).toEqual([]);
      expect(app.page.context().pages()).toHaveLength(1);
      expect(await app.page.locator(FRAME_SELECTOR).count()).toBe(frameBefore);
      expect(await readInside(app.page)).toContain('Hola DOCX');
      await app.capture('office-ui-tras-recorrido');
      await closeAndWaitForRelease(app, 'recorrido.docx');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'lo mismo en Calc: los comandos vetados no hacen nada y la hoja sigue viva',
    async () => {
      await openOffice(app, 'hoja.xlsx');
      for (const url of VETOED.slice(0, 12)) {
        await dispatchInside(app.page, url);
      }
      await app.page.waitForTimeout(SETTLE_MS);
      expect(events).toEqual([]);
      expect(await readInside(app.page)).toContain('Hola XLSX');
      await closeAndWaitForRelease(app, 'hoja.xlsx');
    },
    TEST_TIMEOUT_MS,
  );
});
