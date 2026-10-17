import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import { launchApp, readJson, type AppSession } from './harness';

const EXPLORER = '[aria-label="Explorador de archivos"]';
const VISIBLE_TIMEOUT_MS = 30_000;
const EXIT_MARGIN_MS = 15_000;
const SCRATCH_DIR = 'e2e-explorer';
const WC_NAME = 'wc';
const LOCAL_NAME = 'local-folder';
const OLD_NAME = 'vieja';
const LARGEST_FILE = 'grande.txt';
const THEMES = ['light', 'dark'] as const;
const CLEANUP_RETRIES = 5;
const CLEANUP_RETRY_DELAY_MS = 200;
const ONEDRIVE_FOLDER = 'OneDrive - e2e';
const SELECTED = '[role="row"][aria-selected="true"]';

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
  removeDir(scratchFolder());
});

afterAll(() => {
  scratchDirs.forEach(removeDir);
  stopFixtures(seedRoot);
});

function removeDir(path: string): void {
  rmSync(path, {
    recursive: true,
    force: true,
    maxRetries: CLEANUP_RETRIES,
    retryDelay: CLEANUP_RETRY_DELAY_MS,
  });
}

function scratchFolder(...parts: string[]): string {
  return join(manifest.workspace_root, SCRATCH_DIR, ...parts);
}

function newConfigDir(workspaceRoot = manifest.workspace_root): string {
  const config = readJson<Record<string, unknown>>(manifest.config_path);
  const dir = mkdtempSync(join(tmpdir(), 'dakedaduck-cfg-explorer-'));
  scratchDirs.push(dir);
  const body = { ...config, workspace_root: workspaceRoot };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(body));
  return dir;
}

async function launchExplorer(
  configDir = newConfigDir(),
  userDataDir?: string,
): Promise<AppSession> {
  const app = await launchApp({ configDir, userDataDir });
  session = app;
  await app.page.locator(EXPLORER).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  await app.page.getByRole('grid').waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  return app;
}

function row(page: Page, name: string, kind: 'Carpeta' | 'Archivo'): Locator {
  return page.getByRole('row', { name: `${kind}: ${name}`, exact: true });
}

function toolbarButton(page: Page, name: string, exact = false): Locator {
  return page
    .getByRole('toolbar', { name: 'Herramientas de la carpeta' })
    .getByRole('button', { name, exact });
}

function headers(page: Page): Locator {
  return page.locator(EXPLORER).getByRole('columnheader');
}

async function headerTexts(page: Page): Promise<string[]> {
  const texts = await headers(page).allInnerTexts();
  return texts.map((text) => text.trim());
}

function bottomPanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Panel inferior' });
}

const folderRow = (page: Page, name: string) => row(page, name, 'Carpeta');
const fileRow = (page: Page, name: string) => row(page, name, 'Archivo');

async function enter(page: Page, name: string): Promise<void> {
  await folderRow(page, name).dblclick();
  await currentCrumb(page, name).waitFor();
}

function currentCrumb(page: Page, name: string): Locator {
  return page
    .getByRole('navigation', { name: 'Ruta de navegación' })
    .locator(`[aria-current="page"]`, { hasText: name });
}

async function rowLabels(page: Page): Promise<string[]> {
  return page
    .locator(`${EXPLORER} [role="row"][aria-label]`)
    .evaluateAll((rows) =>
      rows.map((item) => item.getAttribute('aria-label')!),
    );
}

async function tabNames(page: Page): Promise<string[]> {
  return page
    .getByRole('tab')
    .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label')!));
}

async function captureBothThemes(app: AppSession, name: string): Promise<void> {
  for (const theme of THEMES) {
    await app.page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    await app.capture(`${name}-${theme}`);
  }
}

async function exitGracefully(app: AppSession): Promise<void> {
  app.closeMainWindow();
  expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
}

async function expectCleanSession(app: AppSession): Promise<void> {
  expect(app.externalRequests).toEqual([]);
  expect(await app.cspViolations()).toEqual([]);
}

function savedViews(configDir: string): Record<string, { mode: string }> {
  const config = readJson<{
    ui?: { views?: Record<string, { mode: string }> };
  }>(join(configDir, 'config.json'));
  return config.ui?.views ?? {};
}

function sizeOf(name: string): number {
  return statSync(join(manifest.wc_path, name)).size;
}

describe('navegación del explorador sobre la ventana real', () => {
  it('lista la raiz, entra a una copia dentro de la misma pestaña y vuelve con migas, atras, adelante y subir', async () => {
    const app = await launchExplorer();
    const { page } = app;
    expect(await rowLabels(page)).toEqual([
      `Carpeta: ${LOCAL_NAME}`,
      `Carpeta: ${OLD_NAME}`,
      `Carpeta: ${WC_NAME}`,
    ]);
    await app.capture('i9-raiz-cuadricula');

    await enter(page, WC_NAME);
    expect(await tabNames(page)).toEqual([WC_NAME]);
    await fileRow(page, 'texto-plano.txt').waitFor();
    const labels = await rowLabels(page);
    const firstFile = labels.findIndex((label) => label.startsWith('Archivo'));
    expect(
      labels.slice(0, firstFile).every((l) => l.startsWith('Carpeta')),
    ).toBe(true);

    await toolbarButton(page, 'Atrás').click();
    await currentCrumb(page, 'Mis archivos').waitFor();
    await toolbarButton(page, 'Adelante').click();
    await currentCrumb(page, WC_NAME).waitFor();

    await enter(page, 'ignorados');
    await toolbarButton(page, 'Subir un nivel').click();
    await currentCrumb(page, WC_NAME).waitFor();
    await page
      .getByRole('navigation', { name: 'Ruta de navegación' })
      .getByRole('button', { name: 'Mis archivos' })
      .click();
    await currentCrumb(page, 'Mis archivos').waitFor();
    expect(await toolbarButton(page, 'Subir un nivel').isDisabled()).toBe(true);
    await expectCleanSession(app);
  });

  it('abre en pestaña nueva con Ctrl+doble clic, clic central y Ctrl+clic en una miga, sin duplicar', async () => {
    const { page } = await launchExplorer();
    await folderRow(page, LOCAL_NAME).dblclick({ modifiers: ['Control'] });
    await page.getByRole('tab', { name: LOCAL_NAME, exact: true }).waitFor();
    expect(await tabNames(page)).toEqual(['Mis archivos', LOCAL_NAME]);

    await page.getByRole('tab', { name: 'Mis archivos', exact: true }).click();
    await folderRow(page, LOCAL_NAME).click({ button: 'middle' });
    expect(await tabNames(page)).toEqual(['Mis archivos', LOCAL_NAME]);

    await page.getByRole('tab', { name: 'Mis archivos', exact: true }).click();
    await enter(page, WC_NAME);
    await enter(page, 'ignorados');
    await page
      .getByRole('navigation', { name: 'Ruta de navegación' })
      .getByRole('button', { name: WC_NAME })
      .click({ modifiers: ['Control'] });
    await page.getByRole('tab', { name: WC_NAME, exact: true }).waitFor();
    expect(await tabNames(page)).toEqual(['ignorados', LOCAL_NAME, WC_NAME]);
  });

  it('abre un archivo como pestaña de documento y no la duplica', async () => {
    const { page } = await launchExplorer();
    await enter(page, WC_NAME);
    await fileRow(page, 'texto-plano.txt').dblclick();
    await page
      .getByRole('tab', { name: 'texto-plano.txt', exact: true })
      .waitFor();
    await page
      .getByRole('region', { name: 'Editor de texto-plano.txt' })
      .waitFor();
    await page.getByRole('tab', { name: WC_NAME, exact: true }).click();
    await fileRow(page, 'texto-plano.txt').press('Enter');
    expect(await tabNames(page)).toEqual([WC_NAME, 'texto-plano.txt']);
  });

  it('una ruta que ya no existe muestra el error y conserva la ubicacion y el listado', async () => {
    mkdirSync(scratchFolder('hijo'), { recursive: true });
    writeFileSync(scratchFolder('nota.txt'), 'x');
    const app = await launchExplorer();
    const { page } = app;
    await enter(page, SCRATCH_DIR);
    await folderRow(page, 'hijo').waitFor();
    rmSync(scratchFolder('hijo'), { recursive: true });

    await folderRow(page, 'hijo').dblclick();
    const alert = page.locator(`${EXPLORER} [role="alert"]`);
    await alert.waitFor();
    expect(await alert.innerText()).toContain(
      `No se pudo abrir «${SCRATCH_DIR}\\hijo»`,
    );
    await currentCrumb(page, SCRATCH_DIR).waitFor();
    expect(await rowLabels(page)).toEqual([
      'Carpeta: hijo',
      'Archivo: nota.txt',
    ]);
    expect(await tabNames(page)).toEqual([SCRATCH_DIR]);
    await app.capture('i9-error-ubicacion-conservada');

    await toolbarButton(page, 'Actualizar').click();
    await alert.waitFor({ state: 'detached' });
    expect(await rowLabels(page)).toEqual(['Archivo: nota.txt']);
    await expectCleanSession(app);
  });
});

describe('vistas, orden, filtro y ocultos', () => {
  it('cambia entre cuadricula, lista y detalles y deja capturas en ambos temas', async () => {
    const app = await launchExplorer();
    const { page } = app;
    await enter(page, WC_NAME);
    await fileRow(page, 'texto-plano.txt').waitFor();
    await captureBothThemes(app, 'i9-cuadricula');
    expect(await page.locator('.file-grid').count()).toBe(1);

    await toolbarButton(page, 'Lista').click();
    expect(await page.locator('.file-list').count()).toBe(1);
    expect(await headers(page).count()).toBe(0);
    await captureBothThemes(app, 'i9-lista');

    await toolbarButton(page, 'Detalles').click();
    expect(await headerTexts(page)).toEqual([
      'Nombre',
      'Tipo',
      'Tamaño',
      'Modificado',
    ]);
    await captureBothThemes(app, 'i9-detalles');

    await page
      .getByRole('group', { name: 'Columnas' })
      .getByRole('button', { name: 'Tipo' })
      .click();
    expect(await headerTexts(page)).toEqual(['Nombre', 'Tamaño', 'Modificado']);
    await expectCleanSession(app);
  });

  it('ordena por tamaño desde la cabecera, alterna el sentido y mantiene las carpetas primero', async () => {
    const { page } = await launchExplorer();
    await enter(page, WC_NAME);
    await toolbarButton(page, 'Detalles').click();
    const sizeHeader = headers(page).filter({ hasText: 'Tamaño' });

    await sizeHeader.getByRole('button').click();
    expect(await sizeHeader.getAttribute('aria-sort')).toBe('ascending');
    const ascending = (await rowLabels(page)).filter((l) =>
      l.startsWith('Archivo'),
    );
    const sizes = ascending.map((label) =>
      sizeOf(label.replace('Archivo: ', '').split(', ')[0]),
    );
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(ascending.at(-1)).toBe(`Archivo: ${LARGEST_FILE}`);
    const all = await rowLabels(page);
    expect(all.findIndex((l) => l.startsWith('Archivo'))).toBe(
      all.filter((l) => l.startsWith('Carpeta')).length,
    );

    await sizeHeader.getByRole('button').click();
    expect(await sizeHeader.getAttribute('aria-sort')).toBe('descending');
    const descending = (await rowLabels(page)).filter((l) =>
      l.startsWith('Archivo'),
    );
    expect(descending[0]).toBe(`Archivo: ${LARGEST_FILE}`);
  });

  it('filtra por nombre, avisa si nada coincide y muestra los ocultos solo si se piden', async () => {
    mkdirSync(scratchFolder(), { recursive: true });
    writeFileSync(scratchFolder('visible.txt'), 'x');
    writeFileSync(scratchFolder('oculto.txt'), 'x');
    execFileSync('attrib', ['+h', scratchFolder('oculto.txt')]);
    const { page } = await launchExplorer();
    await enter(page, SCRATCH_DIR);
    expect(await rowLabels(page)).toEqual(['Archivo: visible.txt']);

    const hidden = toolbarButton(page, 'Ocultos');
    expect(await hidden.getAttribute('aria-pressed')).toBe('false');
    await hidden.click();
    expect(await rowLabels(page)).toEqual([
      'Archivo: oculto.txt',
      'Archivo: visible.txt',
    ]);

    const filter = page.getByRole('searchbox', { name: 'Filtrar por nombre' });
    await filter.fill('VIS');
    expect(await rowLabels(page)).toEqual(['Archivo: visible.txt']);
    await filter.fill('nada-coincide');
    await page.getByText('Ningún elemento coincide con el filtro.').waitFor();
    await filter.fill('');
    expect(await rowLabels(page)).toHaveLength(2);
  });
});

describe('selección con teclado y ratón', () => {
  it('selecciona un rango con Mayús, todo con Ctrl+A y Supr no hace nada', async () => {
    const app = await launchExplorer();
    const { page } = app;
    await enter(page, WC_NAME);
    await toolbarButton(page, 'Detalles').click();
    const rows = page.locator(`${EXPLORER} [role="row"][aria-label]`);
    await rows.nth(2).click();
    expect(await page.locator(SELECTED).count()).toBe(1);

    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    expect(await page.locator(SELECTED).count()).toBe(3);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.activeElement!).outlineStyle,
      ),
    ).not.toBe('none');
    await app.capture('i9-seleccion-multiple');

    await page.keyboard.press('Control+A');
    const total = await rows.count();
    expect(await page.locator(SELECTED).count()).toBe(total);

    await page.keyboard.press('Delete');
    expect(await page.locator(SELECTED).count()).toBe(total);
    expect(await rows.count()).toBe(total);
    expect(existsSync(join(manifest.wc_path, 'modificado.txt'))).toBe(true);
    expect(await tabNames(page)).toEqual([WC_NAME]);
    await expectCleanSession(app);
  });

  it('Ctrl+clic suma y quita, clic simple reemplaza y las flechas mueven el foco real', async () => {
    const { page } = await launchExplorer();
    await enter(page, WC_NAME);
    const rows = page.locator(`${EXPLORER} [role="row"][aria-label]`);
    await rows.nth(0).click();
    await rows.nth(3).click({ modifiers: ['Control'] });
    expect(await page.locator(SELECTED).count()).toBe(2);
    await rows.nth(3).click({ modifiers: ['Control'] });
    expect(await page.locator(SELECTED).count()).toBe(1);
    await rows.nth(5).click();
    expect(await page.locator(SELECTED).count()).toBe(1);

    await page.keyboard.press('ArrowRight');
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label'),
    );
    expect(focused).toBe(await rows.nth(6).getAttribute('aria-label'));
    await page.keyboard.press('Home');
    expect(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-label'),
      ),
    ).toBe(await rows.nth(0).getAttribute('aria-label'));
  });

  it('Enter abre la carpeta enfocada y la rejilla expone roles ARIA de cuadricula', async () => {
    const { page } = await launchExplorer();
    const grid = page.getByRole('grid');
    expect(await grid.getAttribute('aria-multiselectable')).toBe('true');
    expect(await page.getByRole('gridcell').count()).toBeGreaterThan(0);
    await folderRow(page, WC_NAME).focus();
    await page.keyboard.press('Enter');
    await currentCrumb(page, WC_NAME).waitFor();
  });
});

describe('cabecera de la copia de trabajo', () => {
  it('muestra Working Copy con repositorio, revision, raiz y rama dentro de una copia', async () => {
    const app = await launchExplorer();
    const { page } = app;
    await enter(page, WC_NAME);
    const header = page.getByLabel('Estado de la carpeta');
    await header.getByText('Working Copy').waitFor();
    await header.getByText('Repositorio').waitFor();
    const text = await header.innerText();
    expect(text).toContain('Revisión');
    expect(text).toMatch(/Revisión\s*\n?\s*\d+/);
    expect(text).toContain('Raíz');
    expect(text).toMatch(/Rama\s*\n?\s*\^\//);
    expect(text.toLowerCase()).toContain('repo');
    await captureBothThemes(app, 'i9-wcheader-copia');

    await enter(page, 'ignorados');
    await header.getByText('Working Copy').waitFor();
    await expectCleanSession(app);
  });

  it('muestra Carpeta local fuera de una copia', async () => {
    const app = await launchExplorer();
    const { page } = app;
    await enter(page, LOCAL_NAME);
    const header = page.getByLabel('Estado de la carpeta');
    await header.getByText('Carpeta local').waitFor();
    expect(await header.innerText()).not.toContain('Working Copy');
    await app.capture('i9-wcheader-local');
    await page
      .getByText('La carpeta actual no es una copia de trabajo.')
      .waitFor();
  });

  it('una copia de formato antiguo explica svn upgrade y deja visible el listado', async () => {
    const app = await launchExplorer();
    const { page } = app;
    await enter(page, OLD_NAME);
    const header = page.getByLabel('Estado de la carpeta');
    await header.getByText('Working Copy').waitFor();
    await header.getByText(/revisa el panel inferior/).waitFor();
    expect(await rowLabels(page)).toContain('Archivo: texto-plano.txt');
    await bottomPanel(page)
      .getByText(/svn upgrade/)
      .first()
      .waitFor();
    expect(
      await page
        .locator(EXPLORER)
        .getByText(/svn upgrade/)
        .count(),
    ).toBe(0);
    expect(
      await page
        .getByRole('region', { name: 'Panel inferior' })
        .getByRole('button', { name: 'Actualizar' })
        .count(),
    ).toBe(0);
    await app.capture('i9-copia-antigua');
    await expectCleanSession(app);
  });
});

describe('panel de información de la copia', () => {
  it('conserva actualizar, confirmar y refrescar, muestra el estado y deja el checkout siempre disponible', async () => {
    const app = await launchExplorer();
    const { page } = app;
    const panel = bottomPanel(page);
    await enter(page, LOCAL_NAME);
    await panel
      .getByText('La carpeta actual no es una copia de trabajo.')
      .waitFor();
    expect(await panel.getByLabel('URL del repositorio').count()).toBe(1);
    expect(
      await panel.getByRole('button', { name: 'Actualizar' }).count(),
    ).toBe(0);

    await toolbarButton(page, 'Atrás').click();
    await enter(page, WC_NAME);
    const update = panel.getByRole('button', { name: 'Actualizar' });
    await update.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    expect(await panel.getByLabel('URL del repositorio').count()).toBe(1);
    await panel.getByRole('region', { name: /Estado de la copia/ }).waitFor();
    expect(await panel.innerText()).toContain('modificado.txt');
    await panel.getByRole('button', { name: 'Refrescar estado' }).click();
    await panel.getByRole('region', { name: /Estado de la copia/ }).waitFor();

    await update.click();
    await panel.getByRole('log').waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    expect(await panel.getByRole('button', { name: 'Cleanup' }).count()).toBe(
      0,
    );

    await panel.getByRole('button', { name: 'Confirmar' }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: 'Cancelar' }).first().click();
    await app.capture('i9-panel-informacion');
    await expectCleanSession(app);
  });

  it('avisa que consultar el estado puede descargar archivos cuando la copia esta bajo OneDrive', async () => {
    const oneDriveRoot = join(
      mkdtempSync(join(tmpdir(), 'dakedaduck-od-')),
      ONEDRIVE_FOLDER,
    );
    scratchDirs.push(oneDriveRoot, join(oneDriveRoot, '..'));
    mkdirSync(join(oneDriveRoot, 'ws'), { recursive: true });
    execFileSync(manifest.svn_path, [
      '--config-dir',
      join(manifest.root, 'svn-config'),
      '--non-interactive',
      'checkout',
      '--depth',
      'files',
      manifest.repo_file_url,
      join(oneDriveRoot, 'ws', WC_NAME),
    ]);
    const app = await launchExplorer(newConfigDir(join(oneDriveRoot, 'ws')));
    const { page } = app;
    await enter(page, WC_NAME);
    const panel = bottomPanel(page);
    const notice = panel.getByText(/OneDrive/);
    await notice.waitFor();
    expect(await notice.innerText()).toContain('descargar archivos');
    await app.capture('i9-aviso-onedrive');

    await toolbarButton(page, 'Subir un nivel').click();
    await page
      .getByLabel('Estado de la carpeta')
      .getByText('Carpeta local')
      .waitFor();
    expect(await panel.getByText(/OneDrive/).count()).toBe(0);
  });

  it('no avisa de OneDrive en una copia fuera de OneDrive', async () => {
    const { page } = await launchExplorer();
    await enter(page, WC_NAME);
    await page
      .getByRole('region', { name: 'Panel inferior' })
      .getByRole('button', { name: 'Actualizar' })
      .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    expect(await page.getByText(/OneDrive/).count()).toBe(0);
  });
});

describe('la vista se recuerda tras relanzar', () => {
  it('recuerda el modo, las columnas y el orden de cada carpeta con el mismo perfil y config', async () => {
    const configDir = newConfigDir();
    const userData = newScratchDir('dakedaduck-wv2-explorer-');
    scratchDirs.push(userData);
    const first = await launchExplorer(configDir, userData);
    await enter(first.page, WC_NAME);
    await toolbarButton(first.page, 'Detalles').click();
    await first.page
      .getByRole('group', { name: 'Columnas' })
      .getByRole('button', { name: 'Modificado' })
      .click();
    await headers(first.page)
      .filter({ hasText: 'Tamaño' })
      .getByRole('button')
      .click();
    await exitGracefully(first);
    expect(savedViews(configDir)[WC_NAME]).toMatchObject({ mode: 'details' });

    const second = await launchExplorer(configDir, userData);
    const { page } = second;
    await currentCrumb(page, WC_NAME).waitFor();
    expect(await headerTexts(page)).toEqual(['Nombre', 'Tipo', 'Tamaño']);
    expect(
      await headers(page)
        .filter({ hasText: 'Tamaño' })
        .getAttribute('aria-sort'),
    ).toBe('ascending');

    await toolbarButton(page, 'Subir un nivel').click();
    await currentCrumb(page, 'Mis archivos').waitFor();
    expect(await page.locator('.file-grid').count()).toBe(1);
    await expectCleanSession(second);
  });
});
