import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MODIFIED,
  SCRATCH_DIR,
  VISIBLE_TIMEOUT_MS,
  editorText,
  expectCleanSession,
  launchExplorer,
  newConfigDir,
  openFile,
  removeDir,
  scratchPath,
  typeAtEnd,
  waitForChip,
  writeScratch,
} from './editorDriver';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import { launchApp, type AppSession } from './harness';

const EXIT_MARGIN_MS = 15_000;
const REPO_NAME = 'Repositorio de pruebas';
const EMPTY_HOME =
  'Agrega tu primer repositorio con el botón «Agregar repositorio».';
const MISSING_SUFFIX = '-no-existe';
const APPENDED = 'texto sin guardar';
const SCRATCH_FILE = 'marketplace-sucio.txt';

let session: AppSession | undefined;
let manifest: FixtureManifest;
let seedRoot: string;
const scratchDirs: string[] = [];

beforeAll(() => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
});

afterEach(() => {
  session?.stop();
  session = undefined;
  removeDir(scratchPath(manifest));
});

afterAll(() => {
  scratchDirs.forEach(removeDir);
  stopFixtures(seedRoot);
});

async function launch(
  configDir: string,
  userDataDir?: string,
): Promise<AppSession> {
  const app = await launchApp({ configDir, userDataDir });
  session = app;
  await app.page
    .getByRole('navigation', { name: 'Secciones principales' })
    .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  return app;
}

function sectionButton(page: Page, name: string): Locator {
  return page
    .getByRole('navigation', { name: 'Secciones principales' })
    .getByRole('button', { name });
}

async function openMarketplace(page: Page): Promise<void> {
  await sectionButton(page, 'Marketplace').click();
  await page.getByRole('heading', { name: 'Repositorios' }).waitFor();
}

function repoDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: /repositorio/i });
}

function sidebarAddButton(page: Page): Locator {
  return page
    .getByRole('complementary', { name: 'Barra lateral' })
    .getByRole('button', { name: 'Agregar repositorio' });
}

function homeAddButton(page: Page): Locator {
  return page
    .getByRole('main')
    .getByRole('button', { name: 'Agregar repositorio' });
}

async function fillRepoForm(
  page: Page,
  name: string,
  url: string,
  opener: Locator = sidebarAddButton(page),
): Promise<void> {
  await opener.click();
  const dialog = repoDialog(page);
  await dialog.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  await dialog.getByLabel('Nombre').fill(name);
  await dialog.getByLabel('URL').fill(url);
}

function repoLink(page: Page, name: string): Locator {
  return page
    .getByRole('list', { name: 'Repositorios registrados' })
    .getByRole('button', { name: new RegExp(`^${name}`) });
}

async function exitGracefully(app: AppSession): Promise<void> {
  app.closeMainWindow();
  expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
}

function persistedRegistry(configDir: string): string {
  return readFileSync(join(configDir, 'config.json'), 'utf8');
}

describe('repositorios del Marketplace en la ventana real', () => {
  it('agrega un repositorio file:///, lo guarda y lo muestra tras reiniciar con los mismos datos', async () => {
    const configDir = newConfigDir(manifest, scratchDirs);
    const userData = newScratchDir('dakedaduck-wv2-marketplace-');
    scratchDirs.push(userData);
    const first = await launch(configDir, userData);
    await openMarketplace(first.page);
    await first.page.getByText('Aún no hay repositorios.').waitFor();

    await fillRepoForm(first.page, REPO_NAME, manifest.repo_file_url);
    const dialog = repoDialog(first.page);
    await dialog.getByRole('button', { name: 'Probar conexión' }).click();
    await dialog.getByText('Conexión correcta').waitFor({
      timeout: VISIBLE_TIMEOUT_MS,
    });
    await dialog.getByRole('button', { name: 'Guardar' }).click();
    await dialog.waitFor({ state: 'detached' });
    await repoLink(first.page, REPO_NAME).waitFor();
    await first.capture('fase3-marketplace-repositorio-agregado');
    await expectCleanSession(first);
    await exitGracefully(first);

    const registry = persistedRegistry(configDir);
    expect(registry).toContain(REPO_NAME);
    expect(registry).not.toContain('password');

    const second = await launch(configDir, userData);
    await openMarketplace(second.page);
    await repoLink(second.page, REPO_NAME).waitFor({
      timeout: VISIBLE_TIMEOUT_MS,
    });
    await repoLink(second.page, REPO_NAME).click();
    await second.page
      .getByRole('heading', { name: REPO_NAME, level: 2 })
      .waitFor();
  });

  it('probar un repositorio inexistente muestra el error y no deja guardar nada por sí solo', async () => {
    const configDir = newConfigDir(manifest, scratchDirs);
    const app = await launch(configDir);
    await openMarketplace(app.page);

    await app.page.getByText(EMPTY_HOME).waitFor();
    await fillRepoForm(
      app.page,
      REPO_NAME,
      `${manifest.repo_file_url}${MISSING_SUFFIX}`,
      homeAddButton(app.page),
    );
    const dialog = repoDialog(app.page);
    await dialog.getByRole('button', { name: 'Probar conexión' }).click();
    const failure = dialog.locator('.banner--error');
    await failure.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    expect((await failure.innerText()).trim().length).toBeGreaterThan(0);
    expect(await dialog.getByText('Conexión correcta').count()).toBe(0);
    await app.capture('fase3-marketplace-prueba-fallida');

    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await dialog.waitFor({ state: 'detached' });
    await app.page.getByText('Aún no hay repositorios.').waitFor();
    expect(persistedRegistry(configDir)).not.toContain(REPO_NAME);
  });

  it('el formulario avisa de la caché de Subversion y del http sin cifrar', async () => {
    const app = await launch(newConfigDir(manifest, scratchDirs));
    await openMarketplace(app.page);
    await fillRepoForm(app.page, REPO_NAME, 'http://servidor.invalido/repo');
    const dialog = repoDialog(app.page);

    await dialog.getByText(/Subversion recordará esta credencial/).waitFor();
    await dialog.getByText(/no está cifrada/).waitFor();
    await dialog
      .getByRole('checkbox', { name: 'No recordar la contraseña' })
      .check();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await dialog.waitFor({ state: 'detached' });
  });

  it('la lista de repositorios se maneja solo con el teclado', async () => {
    const configDir = newConfigDir(manifest, scratchDirs);
    const app = await launch(configDir);
    const { page } = app;
    await sectionButton(page, 'Marketplace').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Repositorios' }).waitFor();
    await sidebarAddButton(page).focus();
    await page.keyboard.press('Enter');

    const dialog = repoDialog(page);
    await dialog.getByLabel('Nombre').waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    await page.keyboard.type(REPO_NAME);
    await page.keyboard.press('Tab');
    await page.keyboard.type(manifest.repo_file_url);
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });

    const link = repoLink(page, REPO_NAME);
    await link.waitFor();
    await link.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: REPO_NAME, level: 2 }).waitFor();
    expect(await link.getAttribute('aria-current')).toBe('true');

    await page.keyboard.press('F2');
    await dialog.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });

    await link.focus();
    await page.keyboard.press('Delete');
    const confirmation = page.getByRole('alertdialog');
    await confirmation.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    await confirmation.getByRole('button', { name: 'Quitar' }).click();
    await page.getByText('Aún no hay repositorios.').waitFor();
    expect(persistedRegistry(configDir)).not.toContain(REPO_NAME);
  });
});

describe('convivencia de Marketplace con Mis archivos', () => {
  it('el texto sin guardar sobrevive al ir a Marketplace y volver, y el cierre de ventana lo detecta', async () => {
    writeScratch(manifest, SCRATCH_FILE, 'uno\n');
    const app = await launchExplorer(newConfigDir(manifest, scratchDirs));
    session = app;
    const { page } = app;
    await openFile(page, SCRATCH_DIR, SCRATCH_FILE);
    await typeAtEnd(page, APPENDED);
    await waitForChip(page, MODIFIED);

    await openMarketplace(page);
    await page.getByText(EMPTY_HOME).waitFor();
    expect(await page.getByRole('tablist').isVisible()).toBe(false);

    app.closeMainWindow();
    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    expect(await dialog.innerText()).toContain('cambios sin guardar');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await dialog.waitFor({ state: 'detached' });
    expect(app.isRunning()).toBe(true);

    await sectionButton(page, 'Mis archivos').click();
    await waitForChip(page, MODIFIED);
    expect(await editorText(page)).toContain(APPENDED);
    expect(await page.locator('.monaco-editor').count()).toBe(1);
    await expectCleanSession(app);
  });
});
