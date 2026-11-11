import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import { launchApp, type AppSession } from './harness';

const PANEL = '[aria-label="Explorador de archivos"]';
const VISIBLE_TIMEOUT_MS = 30_000;

let session: AppSession;
let manifest: FixtureManifest;
let seedRoot: string;

beforeAll(async () => {
  seedRoot = newScratchDir('dakedaduck-iso-');
  manifest = seedFixtures(seedRoot);
  session = await launchApp({ configDir: dirname(manifest.config_path) });
  await session.page.locator(PANEL).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
});

afterAll(() => {
  session?.stop();
  stopFixtures(seedRoot);
});

describe('aislamiento de origen cruzado en la ventana real', () => {
  it('la ventana está aislada y tiene hilos de WebAssembly', async () => {
    expect(await session.isolation()).toEqual({
      crossOriginIsolated: true,
      sharedArrayBuffer: true,
      sharedMemory: true,
    });
  });

  it('el documento de la aplicación llega con COOP y COEP exactos y el aislamiento sobrevive a la recarga', async () => {
    const reply = await session.page.reload();
    await session.page.locator(PANEL).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    const headers = reply?.headers() ?? {};
    expect([
      headers['cross-origin-opener-policy'],
      headers['cross-origin-embedder-policy'],
    ]).toEqual(['same-origin', 'require-corp']);
    expect((await session.isolation()).crossOriginIsolated).toBe(true);
  });

  it('no hubo bloqueos por política, peticiones externas ni violaciones de CSP', async () => {
    expect(session.externalRequests).toEqual([]);
    expect(await session.cspViolations()).toEqual([]);
  });
});
