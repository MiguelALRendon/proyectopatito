import { deflateSync } from 'node:zlib';
import type { Locator, Page } from 'playwright-core';
import { expect } from 'vitest';
import { WORKSPACE_FILE_ORIGIN } from '../../../src/services/filesApi';
import {
  ALLOWED_ATTR,
  ALLOWED_TAGS,
  BLOCKED_IMAGE_CLASS,
} from '../../../src/documents/markdown/render';
import {
  auditSnapshot,
  snapshotDom,
  type AuditPolicy,
} from '../../../src/documents/markdown/xssAudit';
import { XSS_FLAG } from '../../../src/documents/markdown/xssCorpus';
import { documentTab, fileRow, THEMES, type ThemeName } from './editorDriver';
import type { AppSession } from './harness';

export const PREVIEW = '[aria-label="Vista previa de Markdown"]';
export const VISIBLE_TIMEOUT_MS = 30_000;
const ROOT_TITLE = 'Mis archivos';
export const SCRATCH_FOLDER = 'e2e-viewers';
export const BLOCKED_SELECTOR = `.${BLOCKED_IMAGE_CLASS}`;

const THEME_BUTTON: Record<ThemeName, string> = {
  light: 'Tema claro',
  dark: 'Tema oscuro',
};
const POLICY: AuditPolicy = {
  tags: ALLOWED_TAGS,
  attributes: ALLOWED_ATTR,
  workspaceOrigin: WORKSPACE_FILE_ORIGIN,
  blockedClass: BLOCKED_IMAGE_CLASS,
};
const PNG_HEADER_ONLY_BYTES = 33;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Array.from({ length: 256 }, (_unused, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

export interface PageEvents {
  dialogs: string[];
}

export function trackDialogs(page: Page): PageEvents {
  const events: PageEvents = { dialogs: [] };
  page.on('dialog', (dialog) => {
    events.dialogs.push(dialog.message());
    dialog.dismiss().catch(() => undefined);
  });
  return events;
}

export async function enterFolder(page: Page, name: string): Promise<void> {
  await page
    .getByRole('row', { name: `Carpeta: ${name}`, exact: true })
    .dblclick();
  await page
    .getByRole('navigation', { name: 'Ruta de navegación' })
    .locator('[aria-current="page"]', { hasText: name })
    .waitFor();
}

export async function showFolder(page: Page, folder: string): Promise<void> {
  await page.getByRole('tab').first().click();
  const crumbs = page.getByRole('navigation', { name: 'Ruta de navegación' });
  const current = await crumbs.locator('[aria-current="page"]').innerText();
  if (current.trim() === folder) return;
  await crumbs.getByRole('button', { name: ROOT_TITLE }).click();
  await enterFolder(page, folder);
}

export async function openInFolder(
  page: Page,
  folder: string,
  name: string,
): Promise<void> {
  await showFolder(page, folder);
  await fileRow(page, name).dblclick();
  await documentTab(page, name).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
}

export async function closeDocument(page: Page, name: string): Promise<void> {
  await documentTab(page, name).click({ button: 'middle' });
  await documentTab(page, name).waitFor({ state: 'detached' });
}

export function modeButton(page: Page, name: string): Locator {
  return page
    .getByRole('group', { name: 'Modo de visualización' })
    .getByRole('button', { name, exact: true });
}

export async function chooseMode(page: Page, name: string): Promise<void> {
  const button = modeButton(page, name);
  await button.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  await button.click();
  await expect.poll(() => button.getAttribute('aria-pressed')).toBe('true');
}

export async function auditPreview(page: Page): Promise<string[]> {
  const snapshot = await page.evaluate(snapshotDom, PREVIEW);
  return auditSnapshot(snapshot, POLICY);
}

export function executedPayload(page: Page): Promise<unknown> {
  return page.evaluate((key) => Reflect.get(window, key), XSS_FLAG);
}

function resolvedTheme(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.documentElement.getAttribute('data-theme') ??
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
}

export async function setTheme(page: Page, theme: ThemeName): Promise<void> {
  if ((await resolvedTheme(page)) !== theme) {
    await page.getByRole('button', { name: THEME_BUTTON[theme] }).click();
  }
  await expect.poll(() => resolvedTheme(page)).toBe(theme);
}

export async function captureBothThemes(
  app: AppSession,
  name: string,
): Promise<void> {
  for (const theme of THEMES) {
    await setTheme(app.page, theme);
    await app.capture(`${name}-${theme}`);
  }
}

export function loadedImages(page: Page, selector: string) {
  return page.$$eval(selector, (images) =>
    images.map((image) => ({
      loaded: (image as HTMLImageElement).complete,
      width: (image as HTMLImageElement).naturalWidth,
      src: (image as HTMLImageElement).currentSrc,
    })),
  );
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function gradientRow(y: number, size: { width: number; height: number }) {
  const pixels = Array.from({ length: size.width }, (_pixel, x) => [
    Math.round((x / size.width) * 255),
    Math.round((y / size.height) * 255),
    160,
    x < size.width / 8 ? 80 : 255,
  ]).flat();
  return Buffer.from([0, ...pixels]);
}

export function gradientPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(6, 9);
  const rows = Array.from({ length: height }, (_row, y) =>
    gradientRow(y, { width, height }),
  );
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function headerOnlyPng(png: Buffer): Buffer {
  return png.subarray(0, PNG_HEADER_ONLY_BYTES);
}

export function bigVectorSvg(): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">',
    '<script>alert("svg")</script>',
    '<rect width="240" height="160" fill="#3a6ea3"/>',
    '<circle cx="120" cy="80" r="50" fill="#f0eef2"/>',
    '<text x="120" y="88" font-size="22" text-anchor="middle" fill="#1a1a1a">SVG inerte</text>',
    '</svg>',
  ].join('\n');
}

const DARK_CHANNEL_LIMIT = 100;

export function darkPixelsByBand(page: Page, bands: number): Promise<number[]> {
  return page.evaluate(
    ([count, limit]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '.pdf-viewer__canvas',
      );
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return [];
      const { width, height } = canvas;
      const { data } = context.getImageData(0, 0, width, height);
      const found = Array.from({ length: count }, () => 0);
      for (let index = 0; index < data.length; index += 4) {
        const row = Math.floor(index / 4 / width);
        if (data[index] < limit) found[Math.floor((row * count) / height)] += 1;
      }
      return found;
    },
    [bands, DARK_CHANNEL_LIMIT] as const,
  );
}

export function centerPixel(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '.pdf-viewer__canvas',
    );
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return [];
    const { width, height } = canvas;
    return Array.from(
      context.getImageData(width / 2, height / 2, 1, 1).data.slice(0, 3),
    );
  });
}

export interface NetworkLog {
  requests: string[];
  responses: { url: string; status: number; csp: string | undefined }[];
}

export function trackNetwork(page: Page): NetworkLog {
  const log: NetworkLog = { requests: [], responses: [] };
  const context = page.context();
  context.on('request', (request) => log.requests.push(request.url()));
  context.on('response', (response) =>
    log.responses.push({
      url: response.url(),
      status: response.status(),
      csp: response.headers()['content-security-policy'],
    }),
  );
  return log;
}
