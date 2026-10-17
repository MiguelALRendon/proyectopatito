import { dirname } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import { launchApp, type AppSession } from './harness';

const APP_ORIGIN = 'http://tauri.localhost';
const VISIBLE_TIMEOUT_MS = 30_000;
const PANEL = '[aria-label="Explorador de archivos"]';

let session: AppSession | undefined;
let manifest: FixtureManifest;
let seedRoot: string;

async function expectCleanSession(app: AppSession): Promise<void> {
  expect(app.externalRequests).toEqual([]);
  expect(await app.cspViolations()).toEqual([]);
}

async function launchSeededApp(): Promise<AppSession> {
  const app = await launchApp({ configDir: dirname(manifest.config_path) });
  session = app;
  await app.page.locator(PANEL).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  return app;
}

beforeAll(() => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
});

afterEach(() => {
  session?.stop();
  session = undefined;
});

afterAll(() => stopFixtures(seedRoot));

describe('ventana real de Tauri', () => {
  it('primer arranque: elegir carpeta de trabajo y llegar al panel', async () => {
    session = await launchApp({ configDir: newScratchDir('dakedaduck-cfg-') });
    const { page } = session;
    expect(new URL(page.url()).origin).toBe(APP_ORIGIN);

    await page
      .getByRole('heading', { name: /Configura dakedaduck svn/ })
      .waitFor();
    await session.capture('i1-primer-arranque');
    await page.locator('#workspace-root').fill(manifest.workspace_root);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.locator(PANEL).waitFor({ timeout: VISIBLE_TIMEOUT_MS });

    await session.capture('i1-panel-tras-configurar');
    expect(await page.locator(PANEL).isVisible()).toBe(true);
    await expectCleanSession(session);
  });

  it('arranque con configuración sembrada: abre el panel directamente', async () => {
    const app = await launchSeededApp();

    await expectCleanSession(app);
  });

  it('una petición externa viola la CSP y queda registrada', async () => {
    const app = await launchSeededApp();
    await app.page.evaluate(() =>
      fetch('https://example.com/').catch(() => undefined),
    );

    const violations = await app.cspViolations();
    expect(violations.some((entry) => entry.includes('connect-src'))).toBe(
      true,
    );
  });

  it('un script en línea viola la CSP y no se ejecuta', async () => {
    const app = await launchSeededApp();
    await app.page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.__ranInline = true';
      document.head.appendChild(script);
    });

    expect((await app.cspViolations()).length).toBeGreaterThan(0);
    expect(
      await app.page.evaluate(
        () => (window as { __ranInline?: boolean }).__ranInline,
      ),
    ).toBeUndefined();
  });
});
