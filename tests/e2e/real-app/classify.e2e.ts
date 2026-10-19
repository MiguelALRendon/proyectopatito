import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { storedZip, u32 } from './containerFixtures';
import { runPowerShell } from './pwsh';
import { closeDocument, enterFolder, showFolder } from './viewersDriver';

const WC = 'wc';
const FOLDER = 'zona-clasificacion';
const OFFICE_SCRIPT = 'scripts/e2e/make-office-fixtures.ps1';
const SUITE_TIMEOUT_MS = 600_000;
const OFFICE_NAMES = [
  'documento.docx',
  'hoja.xlsx',
  'presentacion.pptx',
  'documento.odt',
  'hoja.ods',
  'presentacion.odp',
];
const TAR_BLOCK = 512;
const PADDING = 64;

let manifest: FixtureManifest;
let seedRoot: string;
let app: AppSession;
const keep: string[] = [];

function pad(...parts: (Buffer | number[])[]): Buffer {
  const bytes = Buffer.concat(parts.map((part) => Buffer.from(part)));
  return Buffer.concat([
    bytes,
    Buffer.alloc(Math.max(0, PADDING - bytes.length)),
  ]);
}

function tarFile(): Buffer {
  const block = Buffer.alloc(TAR_BLOCK);
  block.write('a.txt');
  block.write('ustar\x0000', 257, 'latin1');
  block.fill(' ', 148, 156);
  const sum = block.reduce((total, byte) => total + byte, 0);
  block.write(`${sum.toString(8).padStart(6, '0')}\x00 `, 148, 'latin1');
  return Buffer.concat([block, Buffer.alloc(TAR_BLOCK * 2)]);
}

function sevenZip(): Buffer {
  const header = Buffer.concat([
    Buffer.from([0, 4]),
    Buffer.alloc(4),
    Buffer.alloc(20, 1),
  ]);
  const crcTable = Array.from({ length: 256 }, (_unused, n) => {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1)
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const startHeader = header.subarray(6, 26);
  let crc = 0xffffffff;
  for (const byte of startHeader)
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  header.writeUInt32LE(~crc >>> 0, 2);
  return pad(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), header);
}

function ogg(): Buffer {
  const page = Buffer.alloc(27, 0);
  page.write('OggS');
  page[5] = 2;
  page[26] = 1;
  return pad(page, [30], Buffer.from('\x01vorbis'));
}

function ftyp(brand: string): Buffer {
  return pad(
    u32(24, true),
    Buffer.from('ftyp' + brand),
    Buffer.alloc(4),
    Buffer.from(brand),
  );
}

const FIXTURES: Record<string, Buffer> = {
  'sonido.mp3': pad(Buffer.from('ID3\x04\x00\x00'), Buffer.alloc(4)),
  'sonido.wav': pad(Buffer.from('RIFF'), u32(36), Buffer.from('WAVEfmt ')),
  'sonido.flac': pad(Buffer.from('fLaC'), [0, 0, 0, 34]),
  'sonido.ogg': ogg(),
  'video.mp4': ftyp('isom'),
  'video.webm': pad(
    [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82],
    Buffer.from('\x84webm', 'latin1'),
  ),
  'video.avi': pad(Buffer.from('RIFF'), u32(36), Buffer.from('AVI LIST')),
  'datos.zip': storedZip([['leeme.txt', 'hola']]),
  'datos.7z': sevenZip(),
  'datos.rar': pad(Buffer.from('Rar!\x1a\x07\x00')),
  'datos.tar': tarFile(),
  'datos.tar.gz': gzipSync(tarFile()),
  'falso.docx': storedZip([['leeme.txt', 'no soy office']]),
  'renombrado.xlsx': storedZip([
    ['[Content_Types].xml', '<Types/>'],
    ['word/document.xml', '<x/>'],
  ]),
  'ruido.mp3': Buffer.from(
    Array.from({ length: 256 }, (_unused, n) => 0x80 | ((n * 37) & 0x7f)),
  ),
  'suelto.gz': gzipSync(tarFile()),
};

const EXPECTED: [string, string][] = [
  ['sonido.mp3', 'Audio'],
  ['sonido.wav', 'Audio'],
  ['sonido.flac', 'Audio'],
  ['sonido.ogg', 'Audio'],
  ['video.mp4', 'Vídeo'],
  ['video.webm', 'Vídeo'],
  ['video.avi', 'Vídeo'],
];
const ARCHIVES_LISTED = ['datos.zip'];
const ARCHIVES_UNREADABLE = [
  'datos.7z',
  'datos.rar',
  'datos.tar',
  'datos.tar.gz',
];

const FALLBACKS = ['falso.docx', 'renombrado.xlsx', 'ruido.mp3', 'suelto.gz'];

function seedClassificationFolder(): void {
  const folder = join(manifest.wc_path, FOLDER);
  mkdirSync(folder, { recursive: true });
  const officeDir = mkdtempSync(join(tmpdir(), 'dakedaduck-office-'));
  keep.push(officeDir);
  runPowerShell(OFFICE_SCRIPT, ['-OutDir', officeDir]);
  for (const name of OFFICE_NAMES) {
    copyFileSync(join(officeDir, name), join(folder, name));
  }
  for (const [name, bytes] of Object.entries(FIXTURES)) {
    writeFileSync(join(folder, name), bytes);
  }
}

async function cardText(page: Page, name: string): Promise<string> {
  await page.getByRole('tab').first().click();
  await fileRow(page, name).dblclick();
  await documentTab(page, name).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  const card = page.getByRole('article', { name: `Archivo ${name}` });
  await card.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  return card.innerText();
}

beforeAll(async () => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
  seedClassificationFolder();
  app = await launchExplorer(newConfigDir(manifest, keep));
  await showFolder(app.page, WC);
  await enterFolder(app.page, FOLDER);
}, SUITE_TIMEOUT_MS);

afterAll(() => {
  app?.stop();
  keep.forEach(removeDir);
  stopFixtures(seedRoot);
  removeDir(seedRoot);
});

describe('clasificación por contenido en la ventana real: adversarial primero', () => {
  it.each(FALLBACKS)('%s cae a la tarjeta de binario', async (name) => {
    const text = await cardText(app.page, name);
    expect(text).toContain('Archivo binario');
    expect(text).not.toMatch(/Documento de Office|Audio|Vídeo|comprimido/);
    await closeDocument(app.page, name);
  });
});

describe('clasificación por contenido en la ventana real: un fixture de cada tipo', () => {
  it.each(EXPECTED)('%s se reconoce como «%s»', async (name, label) => {
    const text = await cardText(app.page, name);
    expect(text).toContain(label);
    await closeDocument(app.page, name);
  });

  it.each(ARCHIVES_LISTED)(
    '%s se reconoce como comprimido y abre el visor de comprimidos',
    async (name) => {
      const { page } = app;
      await page.getByRole('tab').first().click();
      await fileRow(page, name).dblclick();
      await documentTab(page, name).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await page
        .getByRole('table', { name: 'Contenido del archivo comprimido' })
        .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await closeDocument(page, name);
    },
  );

  it.each(ARCHIVES_UNREADABLE)(
    '%s se reconoce como comprimido pero, sin contenido legible, cae a la tarjeta',
    async (name) => {
      const text = await cardText(app.page, name);
      expect(text).toContain('Archivo comprimido');
      expect(text).toContain('No se pudo leer el archivo comprimido');
      await closeDocument(app.page, name);
    },
  );

  it.each(OFFICE_NAMES)(
    '%s se reconoce como Office y abre el visor en su pestaña',
    async (name) => {
      const { page } = app;
      await page.getByRole('tab').first().click();
      await fileRow(page, name).dblclick();
      await documentTab(page, name).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await page
        .getByRole('region', { name: `Documento ${name}` })
        .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await closeDocument(page, name);
    },
  );

  it('no hubo peticiones externas, bloqueos por política ni violaciones de CSP', async () => {
    expect(app.externalRequests).toEqual([]);
    expect(await app.cspViolations()).toEqual([]);
  });
});
