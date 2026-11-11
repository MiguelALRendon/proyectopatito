import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
import {
  RECORDINGS,
  corruptWavBytes,
  fakeAviBytes,
  flacBytes,
  mp3Bytes,
  noiseMp3Bytes,
  record,
  wavBytes,
} from './mediaFixtures';
import { closeDocument, enterFolder, showFolder } from './viewersDriver';

const WC = 'wc';
const FOLDER = 'zona-medios';
const SUITE_TIMEOUT_MS = 600_000;
const TEST_TIMEOUT_MS = 120_000;
const PLAY_WAIT_MS = 1_500;
const SEEK_WAIT_MS = 1_000;
const PLAYER = '[role="group"][aria-label^="Reproductor de"]';
const MEDIA = 'audio, video';
const MATRIX_FILE = resolve('.bossdream-project/media-matrix.json');

const GENERATED: [string, () => Buffer][] = [
  ['sonido.wav', wavBytes],
  ['sonido.mp3', mp3Bytes],
  ['sonido.flac', flacBytes],
];
const SEEKABLE = ['buscar.wav', 'buscar.mp3', 'buscar.flac'];

let manifest: FixtureManifest;
let seedRoot: string;
let app: AppSession;
const keep: string[] = [];
const rangeRequests: string[] = [];
const matrix: Record<string, string> = {};
let recorded: string[] = [];

function folderPath(name: string): string {
  return join(manifest.wc_path, FOLDER, name);
}

async function openMedia(page: Page, name: string): Promise<void> {
  await page.getByRole('tab').first().click();
  await fileRow(page, name).dblclick();
  await documentTab(page, name).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
}

async function mediaState(page: Page) {
  return page.locator(MEDIA).evaluate((element) => {
    const media = element as HTMLMediaElement;
    return {
      time: media.currentTime,
      paused: media.paused,
      muted: media.muted,
      volume: media.volume,
      duration: media.duration,
      ready: media.readyState,
    };
  });
}

async function waitForMetadata(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const media = document.querySelector(
        'audio, video',
      ) as HTMLMediaElement | null;
      return Boolean(media && media.readyState >= 1);
    },
    undefined,
    { timeout: VISIBLE_TIMEOUT_MS },
  );
}

async function outcomeOf(page: Page, name: string): Promise<string> {
  await openMedia(page, name);
  const card = page.getByRole('article', { name: `Archivo ${name}` });
  const player = page.locator(PLAYER);
  await Promise.race([
    card.waitFor({ timeout: VISIBLE_TIMEOUT_MS }),
    player.waitFor({ timeout: VISIBLE_TIMEOUT_MS }),
  ]);
  await page.waitForTimeout(PLAY_WAIT_MS);
  return (await card.count()) > 0 ? 'tarjeta' : 'reproductor';
}

beforeAll(async () => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
  app = await launchExplorer(newConfigDir(manifest, keep));
  app.page.on('request', (request) => {
    const range = request.headers().range;
    if (range && request.url().includes('workspace-file')) {
      rangeRequests.push(`${request.url().split('/').pop()} ${range}`);
    }
  });
  mkdirSync(join(manifest.wc_path, FOLDER), { recursive: true });
  for (const [name, make] of GENERATED) {
    writeFileSync(folderPath(name), make());
    writeFileSync(folderPath(name.replace('sonido', 'buscar')), make());
  }
  writeFileSync(folderPath('corrupto.wav'), corruptWavBytes());
  writeFileSync(folderPath('video.avi'), fakeAviBytes());
  writeFileSync(folderPath('ruido.mp3'), noiseMp3Bytes());
  recorded = [];
  for (const recording of RECORDINGS) {
    const bytes = await record(app.page, recording);
    if (!bytes) {
      matrix[recording.name] = 'el WebView no sabe grabarlo';
      continue;
    }
    writeFileSync(folderPath(recording.name), bytes);
    recorded.push(recording.name);
  }
  await showFolder(app.page, WC);
  await enterFolder(app.page, FOLDER);
}, SUITE_TIMEOUT_MS);

afterEach(async ({ task }) => {
  if (task.result?.state !== 'fail') return;
  const name = task.name.replace(/\W+/g, '-').slice(0, 60);
  await app.capture(`fallo-medios-${name}`).catch(() => undefined);
});

afterAll(() => {
  mkdirSync(resolve('.bossdream-project'), { recursive: true });
  writeFileSync(MATRIX_FILE, JSON.stringify(matrix, null, 2));
  app?.stop();
  keep.forEach(removeDir);
  stopFixtures(seedRoot);
  removeDir(seedRoot);
});

describe('audio y vídeo en la ventana real: lo que no se puede reproducir, primero', () => {
  it.each([
    ['corrupto.wav', 'una pista corrupta'],
    ['video.avi', 'un AVI, que el WebView no reproduce'],
    ['ruido.mp3', 'ruido con nombre de mp3'],
  ])(
    '%s (%s) muestra la tarjeta y no un reproductor roto',
    async (name) => {
      expect(await outcomeOf(app.page, name)).toBe('tarjeta');
      const card = app.page.getByRole('article', { name: `Archivo ${name}` });
      await expect(card.innerText()).resolves.toMatch(/Tipo/);
      matrix[name] = 'tarjeta';
      await closeDocument(app.page, name);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('audio y vídeo en la ventana real: reproducir, pausar y buscar', () => {
  it.each(GENERATED.map(([name]) => name))(
    '%s se reproduce, se pausa con el teclado y se busca con las flechas',
    async (name) => {
      await openMedia(app.page, name);
      await app.page.locator(PLAYER).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await waitForMetadata(app.page);
      await app.page.locator(PLAYER).focus();
      await app.page.keyboard.press('KeyM');
      expect((await mediaState(app.page)).muted).toBe(true);
      await app.page.keyboard.press('Space');
      await app.page.waitForTimeout(PLAY_WAIT_MS);
      const playing = await mediaState(app.page);
      expect(playing.paused).toBe(false);
      expect(playing.time).toBeGreaterThan(0);
      await app.page.keyboard.press('Space');
      expect((await mediaState(app.page)).paused).toBe(true);
      const before = (await mediaState(app.page)).time;
      await app.page.keyboard.press('ArrowRight');
      await app.page.waitForTimeout(SEEK_WAIT_MS);
      expect((await mediaState(app.page)).time).toBeGreaterThan(before);
      matrix[name] = 'reproduce';
      await closeDocument(app.page, name);
    },
    TEST_TIMEOUT_MS,
  );

  it.each(SEEKABLE)(
    '%s: buscar a la mitad pide un tramo con Range y sigue sonando',
    async (name) => {
      rangeRequests.length = 0;
      await openMedia(app.page, name);
      await app.page.locator(PLAYER).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await waitForMetadata(app.page);
      const { duration } = await mediaState(app.page);
      await app.page.locator(MEDIA).evaluate((element, target) => {
        (element as HTMLMediaElement).muted = true;
        (element as HTMLMediaElement).currentTime = target;
      }, duration / 2);
      await app.page.waitForTimeout(SEEK_WAIT_MS);
      await app.page.getByRole('button', { name: 'Reproducir' }).click();
      await app.page.waitForTimeout(PLAY_WAIT_MS);
      const state = await mediaState(app.page);
      expect(state.time).toBeGreaterThan(duration / 2 - 0.1);
      expect(rangeRequests.length).toBeGreaterThan(0);
      await closeDocument(app.page, name);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'los botones y el control de posición manejan el reproductor',
    async () => {
      await openMedia(app.page, 'sonido.wav');
      await app.page.locator(PLAYER).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await waitForMetadata(app.page);
      await app.page.getByRole('button', { name: 'Silenciar' }).click();
      expect((await mediaState(app.page)).muted).toBe(true);
      await app.page.getByRole('button', { name: 'Activar sonido' }).click();
      await app.page.getByRole('button', { name: 'Silenciar' }).click();
      await app.page.getByRole('button', { name: 'Reproducir' }).click();
      await app.page.getByRole('button', { name: 'Pausar' }).waitFor();
      await app.page.getByRole('button', { name: 'Pausar' }).click();
      const slider = app.page.getByRole('slider', { name: 'Posición' });
      await expect(slider.getAttribute('aria-valuetext')).resolves.toMatch(
        /de 0:03/,
      );
      await closeDocument(app.page, 'sonido.wav');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('audio y vídeo en la ventana real: la matriz de formatos', () => {
  it(
    'los formatos que el WebView graba se reproducen o caen a la tarjeta, nunca a un reproductor roto',
    async () => {
      for (const name of recorded) {
        const outcome = await outcomeOf(app.page, name);
        matrix[name] = outcome === 'reproductor' ? 'reproduce' : 'tarjeta';
        if (outcome === 'reproductor') {
          await waitForMetadata(app.page);
          const state = await mediaState(app.page);
          expect(state.ready, name).toBeGreaterThanOrEqual(1);
        }
        await closeDocument(app.page, name);
      }
      expect(recorded.length).toBeGreaterThan(0);
    },
    SUITE_TIMEOUT_MS,
  );

  it(
    'un vídeo muestra sus dimensiones y puede ir a pantalla completa',
    async () => {
      const video = recorded.find((name) => name === 'clip.webm');
      expect(video).toBeDefined();
      await openMedia(app.page, 'clip.webm');
      await app.page.locator(PLAYER).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      await waitForMetadata(app.page);
      await expect(
        app.page
          .getByText(/160 × 120 px/)
          .first()
          .isVisible(),
      ).resolves.toBe(true);
      await app.page.getByRole('button', { name: 'Pantalla completa' }).click();
      await app.page.waitForTimeout(SEEK_WAIT_MS);
      const isFull = await app.page.evaluate(
        () => document.fullscreenElement !== null,
      );
      expect(isFull).toBe(true);
      await app.page.evaluate(() => document.exitFullscreen());
      await app.page.waitForFunction(() => document.fullscreenElement === null);
      await closeDocument(app.page, 'clip.webm');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('audio y vídeo en la ventana real: sin red ni violaciones', () => {
  it('ninguna petición externa, bloqueo por política ni violación de CSP al reproducir', async () => {
    expect(app.externalRequests).toEqual([]);
    expect(await app.cspViolations()).toEqual([]);
  });
});
