import type { Locator, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  VISIBLE_TIMEOUT_MS,
  documentTab,
  expectCleanSession,
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
import { ipcCalls, setIpcFake } from './ipcGate';
import {
  captureBothThemes,
  closeDocument,
  enterFolder,
  showFolder,
} from './viewersDriver';

const WC = 'wc';
const FIXTURE_FOLDER = 'zona-apertura-externa';
const SUITE_TIMEOUT_MS = 600_000;
const IPC_ORIGIN = 'http://ipc.localhost';
const CAN_OPEN_URL = `${IPC_ORIGIN}/fs_can_open_external`;
const OPEN_COMMAND = 'fs_open_external';
const OPEN_BUTTON = 'Abrir con la aplicación predeterminada';
const PERMITTED = ['informe.docx'];
const PERMITTED_ARCHIVE = 'PAQUETE.ZIP';
const ARCHIVE_TABLE = { name: 'Contenido del archivo comprimido' };
const REFUSED = [
  'programa.exe',
  'factura.pdf.exe',
  'falso.pdf',
  'sin-extension',
  'macro.docm',
  'binario.js',
  'pagina.html',
  'lote.bat',
  'planilla.csv',
  'viejo.doc',
  'atajo.lnk',
];
const EXECUTABLE_CARD = 'programa.exe';

let manifest: FixtureManifest;
let seedRoot: string;
let app: AppSession;
const keep: string[] = [];

interface OpenedCard {
  card: Locator;
  isAllowed: boolean;
}

async function settleRendering(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function openCard(name: string): Promise<OpenedCard> {
  const { page } = app;
  await page.getByRole('tab').first().click();
  const answered = page.waitForResponse(
    (response) => response.url() === CAN_OPEN_URL,
  );
  await fileRow(page, name).dblclick();
  await documentTab(page, name).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  const card = page.getByRole('article', { name: `Archivo ${name}` });
  await card.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  const isAllowed = (await (await answered).json()) as boolean;
  await settleRendering(page);
  return { card, isAllowed };
}

function openButton(card: Locator): Locator {
  return card.getByRole('button', { name: OPEN_BUTTON, exact: true });
}

async function launchedCommands(): Promise<string[]> {
  const calls = await ipcCalls(app.page);
  return calls
    .filter((call) => call.command === OPEN_COMMAND)
    .map((call) => call.rule);
}

beforeAll(async () => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
  app = await launchExplorer(newConfigDir(manifest, keep));
  await setIpcFake(app.page, OPEN_COMMAND, { body: null });
  await showFolder(app.page, WC);
  await enterFolder(app.page, FIXTURE_FOLDER);
}, SUITE_TIMEOUT_MS);

afterAll(() => {
  app?.stop();
  keep.forEach(removeDir);
  stopFixtures(seedRoot);
  removeDir(seedRoot);
});

describe('apertura externa en la ventana real: adversarial primero', () => {
  it.each(REFUSED)('%s no ofrece el botón y nada se lanza', async (name) => {
    const { card, isAllowed } = await openCard(name);
    expect(isAllowed).toBe(false);
    expect(await openButton(card).count()).toBe(0);
    expect(await card.getByText(OPEN_BUTTON).count()).toBe(0);
    expect(await launchedCommands()).toEqual([]);
    await closeDocument(app.page, name);
  });

  it('la tarjeta de un ejecutable sigue mostrando sus datos y el hexadecimal sin el botón', async () => {
    const { card } = await openCard(EXECUTABLE_CARD);
    await card.getByRole('button', { name: 'Mostrar hexadecimal' }).waitFor();
    expect(await openButton(card).count()).toBe(0);
    await captureBothThemes(app, 'i14-sin-boton-ejecutable');
    await closeDocument(app.page, EXECUTABLE_CARD);
  });
});

describe('apertura externa en la ventana real: formatos permitidos', () => {
  it.each(PERMITTED)(
    '%s ofrece el botón y no se lanza al mostrarlo',
    async (name) => {
      const { card, isAllowed } = await openCard(name);
      expect(isAllowed).toBe(true);
      await openButton(card).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
      expect(await launchedCommands()).toEqual([]);
      await closeDocument(app.page, name);
    },
  );

  it('un comprimido permitido abre el visor y conserva el botón de apertura externa', async () => {
    const { page } = app;
    await page.getByRole('tab').first().click();
    await fileRow(page, PERMITTED_ARCHIVE).dblclick();
    await page
      .getByRole('table', ARCHIVE_TABLE)
      .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    await page
      .getByRole('button', { name: OPEN_BUTTON, exact: true })
      .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    expect(await launchedCommands()).toEqual([]);
    await closeDocument(page, PERMITTED_ARCHIVE);
  });

  it('el clic usa la respuesta simulada de la compuerta y no llega a Rust', async () => {
    const { card } = await openCard(PERMITTED[0]);
    await captureBothThemes(app, 'i14-boton-abrir-externo');
    await openButton(card).click();
    await expect.poll(launchedCommands).toEqual(['fake']);
    expect(await card.getByRole('alert').count()).toBe(0);
    await closeDocument(app.page, PERMITTED[0]);
    await expectCleanSession(app);
  });
});
