import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { expect } from 'vitest';
import type { FixtureManifest } from './fixtures';
import { launchApp, readJson, type AppSession } from './harness';

export const EXPLORER = '[aria-label="Explorador de archivos"]';
export const STATUS_BAR = '[aria-label="Estado del documento"]';
export const VISIBLE_TIMEOUT_MS = 30_000;
export const SCRATCH_DIR = 'e2e-editor';
export const WC_NAME = 'wc';
export const MODIFIED = 'Modificado';
export const SAVED = 'Guardado';
export const THEMES = ['light', 'dark'] as const;

export type ThemeName = (typeof THEMES)[number];

const THEME_BUTTON: Record<ThemeName, string> = {
  light: 'Tema claro',
  dark: 'Tema oscuro',
};
const CLEANUP_RETRIES = 5;
const CLEANUP_RETRY_DELAY_MS = 200;
const THEME_SETTLE_MS = 10_000;
const BACKGROUND_TOLERANCE = 0;
const NON_BREAKING_SPACE = / /g;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

export function removeDir(path: string): void {
  rmSync(path, {
    recursive: true,
    force: true,
    maxRetries: CLEANUP_RETRIES,
    retryDelay: CLEANUP_RETRY_DELAY_MS,
  });
}

export function scratchPath(manifest: FixtureManifest, name = ''): string {
  return join(manifest.workspace_root, SCRATCH_DIR, name);
}

export function writeScratch(
  manifest: FixtureManifest,
  name: string,
  content: string | Buffer,
): string {
  mkdirSync(scratchPath(manifest), { recursive: true });
  const path = scratchPath(manifest, name);
  writeFileSync(path, content);
  return path;
}

export function newConfigDir(
  manifest: FixtureManifest,
  keep: string[],
): string {
  const config = readJson<Record<string, unknown>>(manifest.config_path);
  const dir = mkdtempSync(join(tmpdir(), 'dakedaduck-cfg-editor-'));
  keep.push(dir);
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}

export async function launchExplorer(configDir: string): Promise<AppSession> {
  const app = await launchApp({ configDir });
  await app.page.locator(EXPLORER).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  await app.page.getByRole('grid').waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  return app;
}

export function fileRow(page: Page, name: string): Locator {
  const label = `Archivo: ${name}`;
  return page.locator(
    `${EXPLORER} [role="row"][aria-label="${label}"], ${EXPLORER} [role="row"][aria-label^="${label},"]`,
  );
}

export function documentTab(page: Page, name: string): Locator {
  const escaped = name.replace(REGEX_SPECIALS, '\\$&');
  return page.getByRole('tab', { name: new RegExp(`^${escaped}( \\(|$)`) });
}

async function enterFolder(page: Page, name: string): Promise<void> {
  await page
    .getByRole('row', { name: `Carpeta: ${name}`, exact: true })
    .dblclick();
  await page
    .getByRole('navigation', { name: 'Ruta de navegación' })
    .locator('[aria-current="page"]', { hasText: name })
    .waitFor();
}

export async function waitForEditor(page: Page): Promise<void> {
  await page.locator(STATUS_BAR).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  await page.locator('.monaco-editor').waitFor();
}

export async function openFile(
  page: Page,
  folder: string,
  name: string,
): Promise<void> {
  await enterFolder(page, folder);
  await fileRow(page, name).dblclick();
  await documentTab(page, name).waitFor();
  await waitForEditor(page);
}

export async function openFromFolderTab(
  page: Page,
  folder: string,
  name: string,
): Promise<void> {
  await page.getByRole('tab', { name: folder, exact: true }).click();
  await fileRow(page, name).dblclick();
  await documentTab(page, name).waitFor();
  await waitForEditor(page);
  await expect
    .poll(() => page.locator('.text-editor__title').first().innerText())
    .toBe(name);
}

export function noticeBanner(page: Page, text: string): Locator {
  return page.locator('.banner[role="alert"]').filter({ hasText: text });
}

export function chipLocator(page: Page): Locator {
  return page.locator('.text-editor__chip').first();
}

export async function waitForChip(page: Page, text: string): Promise<void> {
  await expect
    .poll(() => chipLocator(page).innerText(), { timeout: VISIBLE_TIMEOUT_MS })
    .toBe(text);
}

export async function typeAtEnd(page: Page, text: string): Promise<void> {
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

export function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Guardar', exact: true });
}

export async function editorText(page: Page): Promise<string> {
  const text = await page.locator('.monaco-editor .view-lines').innerText();
  return text.replace(NON_BREAKING_SPACE, ' ');
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

export async function showTheme(page: Page, theme: ThemeName): Promise<void> {
  const current = await page.evaluate(
    () =>
      document.documentElement.getAttribute('data-theme') ??
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  if (current !== theme) {
    await page.getByRole('button', { name: THEME_BUTTON[theme] }).click();
  }
  await expect
    .poll(() => editorMatchesPageBackground(page), { timeout: THEME_SETTLE_MS })
    .toBe(true);
}

export async function captureBothThemes(
  app: AppSession,
  name: string,
): Promise<void> {
  for (const theme of THEMES) {
    await showTheme(app.page, theme);
    await app.capture(`${name}-${theme}`);
  }
}

export interface DialogCapture {
  name: string;
  open: () => Promise<void>;
  dismiss: string;
}

export async function captureDialogBothThemes(
  app: AppSession,
  capture: DialogCapture,
): Promise<void> {
  for (const theme of THEMES) {
    await showTheme(app.page, theme);
    await capture.open();
    const dialog = app.page.getByRole('alertdialog');
    await dialog.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    await app.capture(`${capture.name}-${theme}`);
    await dialog.getByRole('button', { name: capture.dismiss }).click();
    await dialog.waitFor({ state: 'detached' });
  }
}

export async function expectCleanSession(app: AppSession): Promise<void> {
  expect(app.externalRequests).toEqual([]);
  expect(await app.cspViolations()).toEqual([]);
}
