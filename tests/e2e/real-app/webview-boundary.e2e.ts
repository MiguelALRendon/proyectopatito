import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchExplorer, newConfigDir, removeDir } from './editorDriver';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import type { AppSession } from './harness';
import { rawSession, targets } from './rawCdp';

const SUITE_TIMEOUT_MS = 300_000;
const SETTLE_MS = 2_500;
const EXTERNAL = 'https://example.com/';
const APP_HOST = 'tauri.localhost';
const DOWNLOAD_NAME = 'descarga-prohibida.bin';

let manifest: FixtureManifest;
let seedRoot: string;
let app: AppSession;
const keep: string[] = [];
const popups: string[] = [];
const externalFailures: string[] = [];

async function attempt(script: string): Promise<void> {
  await app.page.evaluate(`setTimeout(() => { ${script} }, 0)`);
  await app.page.waitForTimeout(SETTLE_MS);
}

async function expectStillOnTheApp(): Promise<void> {
  expect(new URL(app.page.url()).host).toBe(APP_HOST);
  await app.page
    .getByRole('grid')
    .waitFor({ timeout: 3_000 })
    .catch(() => undefined);
}

beforeAll(async () => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
  app = await launchExplorer(newConfigDir(manifest, keep));
  const { page } = app;
  page.on('popup', (popup) => popups.push(popup.url()));
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(EXTERNAL)) {
      externalFailures.push(request.failure()?.errorText ?? '');
    }
  });
}, SUITE_TIMEOUT_MS);

afterAll(() => {
  app?.stop();
  keep.forEach(removeDir);
  stopFixtures(seedRoot);
  removeDir(seedRoot);
});

describe('frontera del WebView desde Rust: cada canal de salida', () => {
  it('navegar la ventana principal a una URL externa queda denegado', async () => {
    await attempt(`window.location.assign('${EXTERNAL}')`);
    await expectStillOnTheApp();
  });

  it('cambiar location.href a una URL externa queda denegado', async () => {
    await attempt(`window.location.href = '${EXTERNAL}'`);
    await expectStillOnTheApp();
  });

  it('enviar un formulario a una URL externa queda denegado', async () => {
    await attempt(`
      const form = document.createElement('form');
      form.action = '${EXTERNAL}';
      form.method = 'post';
      document.body.appendChild(form);
      form.submit();
    `);
    await expectStillOnTheApp();
  });

  it('un enlace con target _blank no abre ventana', async () => {
    await attempt(`
      const link = document.createElement('a');
      link.href = '${EXTERNAL}';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
    `);
    await expectStillOnTheApp();
    expect(popups).toEqual([]);
  });

  it('window.open no abre ventana', async () => {
    await attempt(`window.open('${EXTERNAL}', '_blank')`);
    await expectStillOnTheApp();
    expect(popups).toEqual([]);
  });

  it('navegar a los protocolos propios como documento tampoco está permitido', async () => {
    await attempt(
      `window.location.assign('http://zeta-assets.localhost/host.html')`,
    );
    await expectStillOnTheApp();
    await attempt(
      `window.location.assign('http://workspace-file.localhost/a.txt')`,
    );
    await expectStillOnTheApp();
  });

  it('una descarga queda cancelada: ni ventana de descargas ni archivo en disco', async () => {
    const downloaded = join(homedir(), 'Downloads', DOWNLOAD_NAME);
    rmSync(downloaded, { force: true });
    const browserSession = await rawSession(true);
    await browserSession.send('Browser.setDownloadBehavior', {
      behavior: 'default',
    });
    const pageSession = await rawSession(false);
    await pageSession.send('Runtime.evaluate', {
      expression: `(() => {
        const url = URL.createObjectURL(new Blob(['x']));
        const link = document.createElement('a');
        link.href = url;
        link.download = '${DOWNLOAD_NAME}';
        document.body.appendChild(link);
        link.click();
      })()`,
    });
    await app.page.waitForTimeout(SETTLE_MS * 2);
    pageSession.close();
    browserSession.close();
    expect(existsSync(downloaded)).toBe(false);
    expect(
      (await targets()).filter((entry) => entry.startsWith('page')),
    ).toHaveLength(1);
    await expectStillOnTheApp();
  });

  it('los intentos de navegación terminaron abortados y la ventana nunca cambió', async () => {
    expect(externalFailures.length).toBeGreaterThan(0);
    expect(externalFailures.every((text) => text.includes('ERR_ABORTED'))).toBe(
      true,
    );
    expect(await app.cspViolations()).toEqual([]);
  });
});
