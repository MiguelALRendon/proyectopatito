import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Frame, Locator, Page } from 'playwright-core';
import { VISIBLE_TIMEOUT_MS, documentTab, fileRow } from './editorDriver';
import type { FixtureManifest } from './fixtures';
import type { AppSession } from './harness';
import { runPowerShell } from './pwsh';
import { closeDocument } from './viewersDriver';

export const OFFICE_SCRIPT = 'scripts/e2e/make-office-fixtures.ps1';
export const READER_SCRIPT = 'scripts/e2e/read-office-text.ps1';
export const LEGACY_DIR = resolve('tests/fixtures/office/legacy');
export const STAGE = '.office-viewer__stage';
export const READY_STAGE = `${STAGE}[data-phase="ready"]`;
export const FRAME_SELECTOR = 'iframe.office-frame';
export const OPEN_TIMEOUT_MS = 120_000;
export const DRAW_SETTLE_MS = 4_000;
export const MODIFIED_CHIP = 'Modificado';
export const SAVED_CHIP = 'Guardado';

const CHIP = '.office-viewer__chip';
const SAVE_BUTTON = 'Guardar';

export interface OfficeSeed {
  generatedDir: string;
  folder: string;
}

export function generateOfficeFixtures(keep: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'dakedaduck-office-'));
  keep.push(dir);
  runPowerShell(OFFICE_SCRIPT, ['-OutDir', dir]);
  return dir;
}

export function seedFolder(
  manifest: FixtureManifest,
  folderName: string,
): string {
  const folder = join(manifest.wc_path, folderName);
  mkdirSync(folder, { recursive: true });
  return folder;
}

export function copyFixture(
  source: string,
  folder: string,
  name: string,
): string {
  const target = join(folder, name);
  copyFileSync(source, target);
  return target;
}

export function readOfficeText(path: string): string {
  return runPowerShell(READER_SCRIPT, ['-Path', path]);
}

export function zetaFrame(page: Page): Frame {
  const frame = page
    .frames()
    .find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error('No hay iframe de ZetaOffice');
  return frame;
}

export async function openOffice(app: AppSession, name: string): Promise<void> {
  const { page } = app;
  await page.getByRole('tab').first().click();
  await fileRow(page, name).dblclick();
  await documentTab(page, name).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  await page
    .locator(READY_STAGE)
    .waitFor({ timeout: OPEN_TIMEOUT_MS })
    .catch(async (error: Error) => {
      await app.capture(`office-fail-${name}`);
      const text = await page.locator('[role="tabpanel"]').innerText();
      throw new Error(`${error.message} Panel: ${text}`);
    });
  await page.waitForTimeout(DRAW_SETTLE_MS);
}

export async function closeAndWaitForRelease(
  app: AppSession,
  name: string,
): Promise<void> {
  await closeDocument(app.page, name);
  await app.page.locator(FRAME_SELECTOR).waitFor({
    state: 'detached',
    timeout: VISIBLE_TIMEOUT_MS,
  });
}

export function chip(page: Page): Locator {
  return page.locator(CHIP).first();
}

export function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: SAVE_BUTTON, exact: true });
}

export async function insertText(page: Page, text: string): Promise<void> {
  const result = await zetaFrame(page).evaluate(
    (value) =>
      (
        window as unknown as {
          __officeTest: {
            insert: (t: string) => Promise<{ modified: boolean }>;
          };
        }
      ).__officeTest.insert(value),
    text,
  );
  if (!result) throw new Error('El gancho de pruebas no respondió');
}

export async function readInside(page: Page): Promise<string> {
  const result = await zetaFrame(page).evaluate(() =>
    (
      window as unknown as {
        __officeTest: { read: () => Promise<{ text: string }> };
      }
    ).__officeTest.read(),
  );
  return result.text;
}

export async function waitForChip(page: Page, label: string): Promise<void> {
  await page
    .locator(CHIP, { hasText: label })
    .first()
    .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
}

export function webviewPrivateMegabytes(): number {
  const script =
    "$wv = Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | Where-Object { $_.CommandLine -match 'dakedaduck' };" +
    '$procs = $wv | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue };' +
    '[math]::Round((($procs | Measure-Object PrivateMemorySize64 -Sum).Sum) / 1MB)';
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  });
  return Number(result.stdout.trim());
}

export interface InnerWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function innerWindow(page: Page): Promise<InnerWindow> {
  return zetaFrame(page).evaluate(() =>
    (
      window as unknown as {
        __officeTest: { windowSize: () => Promise<InnerWindow> };
      }
    ).__officeTest.windowSize(),
  );
}

export async function dispatchInside(page: Page, url: string): Promise<void> {
  await zetaFrame(page).evaluate(
    (command) =>
      (
        window as unknown as {
          __officeTest: { dispatch: (u: string) => Promise<unknown> };
        }
      ).__officeTest.dispatch(command),
    url,
  );
}
