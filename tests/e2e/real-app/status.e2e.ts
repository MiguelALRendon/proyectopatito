import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
const SAVE_TIMEOUT_MS = 15_000;
const SAVE_POLL_MS = 150;
const EXIT_MARGIN_MS = 15_000;
const SCRATCH_DIR = 'e2e-status';
const WC_NAME = 'wc';
const REMOTE_NAME = 'remoto';
const REMOTE_FILE = 'lf.txt';
const FAVORITE_NAMES = ['fav-a', 'fav-b', 'fav-c'];
const RENAMED = 'Azul';
const WRONG_PASSWORD = 'clave-equivocada';
const DRAG_STEPS = 12;
const DROP_INSET_PX = 2;
const THEMES = ['light', 'dark'] as const;
const CLEANUP_RETRIES = 5;
const CLEANUP_RETRY_DELAY_MS = 200;
const UNAVAILABLE_TEXT = 'No disponible';
const NEW_FOLDER = 'carpeta-nueva';

interface SavedFavorite {
  path: string;
  name: string;
}

interface Expectation {
  kind: 'Archivo' | 'Carpeta';
  name: string;
  state: string;
  label: string;
}

const ROOT_EXPECTATIONS: Expectation[] = [
  {
    kind: 'Archivo',
    name: 'modificado.txt',
    state: 'modified',
    label: 'Modificado',
  },
  { kind: 'Archivo', name: 'agregado.txt', state: 'added', label: 'Agregado' },
  {
    kind: 'Archivo',
    name: 'no-versionado.txt',
    state: 'unversioned',
    label: 'Sin versionar',
  },
  {
    kind: 'Archivo',
    name: 'bloqueado.txt',
    state: 'locked',
    label: 'Bloqueado',
  },
  {
    kind: 'Archivo',
    name: 'conflicto.txt',
    state: 'conflicted',
    label: 'En conflicto',
  },
  {
    kind: 'Archivo',
    name: 'reemplazado.txt',
    state: 'replaced',
    label: 'Reemplazado',
  },
  {
    kind: 'Carpeta',
    name: 'tipo-cambiado.txt',
    state: 'obstructed',
    label: 'Tipo cambiado',
  },
  {
    kind: 'Carpeta',
    name: 'externos',
    state: 'contains_changes',
    label: 'Contiene cambios',
  },
];

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

function newConfigDir(): string {
  const config = readJson<Record<string, unknown>>(manifest.config_path);
  const dir = mkdtempSync(join(tmpdir(), 'dakedaduck-cfg-status-'));
  scratchDirs.push(dir);
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}

function configText(configDir: string): string {
  return readFileSync(join(configDir, 'config.json'), 'utf8');
}

async function launchStatusApp(
  configDir = newConfigDir(),
  userDataDir?: string,
): Promise<AppSession> {
  const app = await launchApp({ configDir, userDataDir });
  session = app;
  await app.page.locator(EXPLORER).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  await app.page.getByRole('grid').waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  return app;
}

function entryRow(page: Page, kind: string, name: string): Locator {
  const label = `${kind}: ${name}`;
  return page.locator(
    `${EXPLORER} [role="row"][aria-label="${label}"], ${EXPLORER} [role="row"][aria-label^="${label},"]`,
  );
}

function toolbarButton(page: Page, name: string): Locator {
  return page
    .getByRole('toolbar', { name: 'Herramientas de la carpeta' })
    .getByRole('button', { name, exact: true });
}

function currentCrumb(page: Page, name: string): Locator {
  return page
    .getByRole('navigation', { name: 'Ruta de navegación' })
    .locator('[aria-current="page"]', { hasText: name });
}

async function enter(page: Page, name: string): Promise<void> {
  await entryRow(page, 'Carpeta', name).dblclick();
  await currentCrumb(page, name).waitFor();
}

async function goToRoot(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Ruta de navegación' })
    .getByRole('button', { name: 'Mis archivos' })
    .click();
  await currentCrumb(page, 'Mis archivos').waitFor();
}

async function expectBadge(
  page: Page,
  expectation: Expectation,
): Promise<void> {
  const row = entryRow(page, expectation.kind, expectation.name);
  const badge = row.locator(`.svn-badge[data-state="${expectation.state}"]`);
  await badge.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  expect((await badge.innerText()).trim()).toBe(expectation.label);
}

async function waitForStatus(page: Page): Promise<void> {
  await page
    .locator(`${EXPLORER} .status-notice__progress`)
    .waitFor({ state: 'detached', timeout: VISIBLE_TIMEOUT_MS });
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

function bottomPanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Panel inferior' });
}

describe('distintivos de estado sobre la ventana real', () => {
  it('muestra el distintivo de cada estado del fixture en su archivo, con texto', async () => {
    const app = await launchStatusApp();
    const { page } = app;
    await enter(page, WC_NAME);
    for (const expectation of ROOT_EXPECTATIONS) {
      await expectBadge(page, expectation);
    }
    await waitForStatus(page);

    const clean = entryRow(page, 'Archivo', 'texto-plano.txt');
    expect(await clean.locator('.svn-badge').count()).toBe(0);
    expect(await clean.getAttribute('aria-label')).toBe(
      'Archivo: texto-plano.txt',
    );
    expect(
      await entryRow(page, 'Carpeta', 'ignorados')
        .locator('.svn-badge')
        .count(),
    ).toBe(0);
    await captureBothThemes(app, 'i10-distintivos');
    await toolbarButton(page, 'Lista').click();
    await entryRow(page, 'Archivo', 'conflicto.txt').scrollIntoViewIfNeeded();
    await captureBothThemes(app, 'i10-distintivos-lista');
    await toolbarButton(page, 'Cuadrícula').click();

    await enter(page, 'ignorados');
    await expectBadge(page, {
      kind: 'Archivo',
      name: 'ignorado.tmp',
      state: 'ignored',
      label: 'Ignorado',
    });
    await toolbarButton(page, 'Subir un nivel').click();
    await currentCrumb(page, WC_NAME).waitFor();

    await enter(page, 'externos');
    await expectBadge(page, {
      kind: 'Carpeta',
      name: 'carpeta-externa',
      state: 'external',
      label: 'Externo',
    });
    await expectCleanSession(app);
  });

  it('muestra eliminado y faltante en la tabla de cambios, porque esos archivos ya no estan en el disco', async () => {
    const { page } = await launchStatusApp();
    await enter(page, WC_NAME);
    const table = bottomPanel(page).getByRole('table');
    await table.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    const rowOf = (name: string) =>
      table.getByRole('row').filter({ hasText: name });
    expect(await rowOf('eliminado.txt').innerText()).toContain('Eliminado');
    expect(await rowOf('faltante.txt').innerText()).toContain('Faltante');
    expect(await entryRow(page, 'Archivo', 'faltante.txt').count()).toBe(0);
  });

  it('muestra la columna SVN con texto para cada archivo y ordena por estado', async () => {
    const app = await launchStatusApp();
    const { page } = app;
    await enter(page, WC_NAME);
    await expectBadge(page, ROOT_EXPECTATIONS[0]);
    await toolbarButton(page, 'Detalles').click();
    await page
      .getByRole('group', { name: 'Columnas' })
      .getByRole('button', { name: 'SVN' })
      .click();
    const header = page
      .locator(EXPLORER)
      .getByRole('columnheader', { name: 'SVN' });
    await header.waitFor();

    const cell = async (kind: string, name: string) => {
      const row = entryRow(page, kind, name);
      return (await row.getByRole('gridcell').last().innerText()).trim();
    };
    expect(await cell('Archivo', 'texto-plano.txt')).toBe('Sin cambios');
    expect(await cell('Archivo', 'modificado.txt')).toBe('Modificado');
    expect(await cell('Archivo', 'bloqueado.txt')).toBe('Bloqueado');
    expect(await cell('Archivo', 'conflicto.txt')).toBe('En conflicto');
    await captureBothThemes(app, 'i10-columna-svn');

    await header.getByRole('button').click();
    expect(await header.getAttribute('aria-sort')).toBe('ascending');
    const labels = await page
      .locator(`${EXPLORER} [role="row"][aria-label^="Archivo"]`)
      .evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label')!));
    const position = (name: string) =>
      labels.findIndex((label) => label.startsWith(`Archivo: ${name}`));
    expect(position('conflicto.txt')).toBe(0);
    expect(position('modificado.txt')).toBeLessThan(
      position('no-versionado.txt'),
    );
    expect(position('no-versionado.txt')).toBeLessThan(
      position('texto-plano.txt'),
    );
    await header.getByRole('button').click();
    expect(await header.getAttribute('aria-sort')).toBe('descending');
    await expectCleanSession(app);
  });
});

describe('arbol de carpetas sobre la ventana real', () => {
  const tree = (page: Page) =>
    page.getByRole('tree', { name: 'Árbol de carpetas' });
  const treeItem = (page: Page, name: string) =>
    tree(page)
      .getByRole('treeitem')
      .filter({
        has: page.locator('.file-tree__name', {
          hasText: new RegExp(`^${name}$`),
        }),
      });

  it('carga las carpetas por demanda y se maneja con el teclado', async () => {
    const app = await launchStatusApp();
    const { page } = app;
    await tree(page).waitFor();
    const root = treeItem(page, 'Mis archivos');
    await root.waitFor();
    expect(await root.getAttribute('aria-level')).toBe('1');
    expect(await root.getAttribute('aria-expanded')).toBe('true');
    const wc = treeItem(page, WC_NAME);
    await wc.waitFor();
    expect(await wc.getAttribute('aria-expanded')).toBe('false');
    expect(await treeItem(page, 'ignorados').count()).toBe(0);

    await wc.focus();
    await page.keyboard.press('ArrowRight');
    await treeItem(page, 'ignorados').waitFor();
    expect(await wc.getAttribute('aria-expanded')).toBe('true');
    expect(await treeItem(page, 'ignorados').getAttribute('aria-level')).toBe(
      '3',
    );

    await page.keyboard.press('ArrowDown');
    expect(
      await page.evaluate(() => document.activeElement?.textContent),
    ).toContain('externos');
    await page.keyboard.press('ArrowLeft');
    expect(
      await page.evaluate(() => document.activeElement?.textContent),
    ).toContain(WC_NAME);
    await page.keyboard.press('Enter');
    await currentCrumb(page, WC_NAME).waitFor();
    expect(await wc.getAttribute('aria-selected')).toBe('true');
    await captureBothThemes(app, 'i10-arbol');
    await expectCleanSession(app);
  });

  it('muestra una carpeta creada por una actualizacion sin colapsar ni expandir', async () => {
    mkdirSync(scratchFolder(), { recursive: true });
    runSvn(['checkout', manifest.repo_file_url, scratchFolder(REMOTE_NAME)]);
    runSvn(['mkdir', join(manifest.peer_wc_path, NEW_FOLDER)]);
    runSvn(['commit', manifest.peer_wc_path, '-m', 'carpeta nueva del par']);
    const { page } = await launchStatusApp();
    await treeItem(page, SCRATCH_DIR).click();
    await treeItem(page, REMOTE_NAME).click();
    await currentCrumb(page, REMOTE_NAME).waitFor();
    await treeItem(page, 'ignorados').waitFor();
    expect(await treeItem(page, NEW_FOLDER).count()).toBe(0);

    await bottomPanel(page).getByRole('button', { name: 'Actualizar' }).click();
    await treeItem(page, NEW_FOLDER).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    expect(
      await treeItem(page, REMOTE_NAME).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(await treeItem(page, NEW_FOLDER).getAttribute('aria-level')).toBe(
      '4',
    );
  });

  it('cumple lo basico de accesibilidad: un solo foco, anillo visible y carpetas con cambios nombradas', async () => {
    const { page } = await launchStatusApp();
    await tree(page).waitFor();
    await treeItem(page, WC_NAME).waitFor();
    const tabbable = await tree(page)
      .getByRole('treeitem')
      .evaluateAll(
        (items) =>
          items.filter((item) => item.getAttribute('tabindex') === '0').length,
      );
    expect(tabbable).toBe(1);

    await treeItem(page, WC_NAME).focus();
    const outline = await page.evaluate(
      () => getComputedStyle(document.activeElement as Element).outlineStyle,
    );
    expect(outline).not.toBe('none');

    await treeItem(page, WC_NAME).click();
    await currentCrumb(page, WC_NAME).waitFor();
    await waitForStatus(page);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[role="treeitem"]')].some((item) =>
          item.getAttribute('aria-label')?.includes('contiene cambios'),
        ),
      undefined,
      { timeout: VISIBLE_TIMEOUT_MS },
    );
    expect(await treeItem(page, WC_NAME).getAttribute('aria-label')).toBe(
      `${WC_NAME}, contiene cambios`,
    );
  });
});

function favoriteLink(page: Page, name: string): Locator {
  return page.locator('.favorites__link', {
    has: page.locator('.favorites__name', {
      hasText: new RegExp(`^${name}$`),
    }),
  });
}

async function favoriteNames(page: Page): Promise<string[]> {
  const names = await page.locator('.favorites__name').allInnerTexts();
  return names.map((name) => name.trim());
}

async function starFolder(page: Page, folder: string): Promise<void> {
  await goToRoot(page);
  await enter(page, SCRATCH_DIR);
  await enter(page, folder);
  const star = toolbarButton(page, 'Marcar como favorita');
  await star.click();
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('.favorites__name')].some(
        (item) => item.textContent?.trim() === name,
      ),
    folder,
  );
  expect(await star.getAttribute('aria-pressed')).toBe('true');
}

async function dragFavorite(
  page: Page,
  source: string,
  target: string,
): Promise<void> {
  const from = await favoriteLink(page, source).boundingBox();
  const to = await favoriteLink(page, target).boundingBox();
  if (!from || !to) throw new Error('los favoritos no tienen caja visible');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2,
    to.y + to.height - DROP_INSET_PX,
    { steps: DRAG_STEPS },
  );
  await page.mouse.up();
}

function savedFavorites(configDir: string): SavedFavorite[] {
  const config = JSON.parse(configText(configDir)) as {
    ui?: { favorites?: SavedFavorite[] };
  };
  return config.ui?.favorites ?? [];
}

async function waitForSaved(
  configDir: string,
  expected: SavedFavorite[],
): Promise<void> {
  const deadline = Date.now() + SAVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const saved = savedFavorites(configDir);
      if (JSON.stringify(saved) === JSON.stringify(expected)) return;
    } catch {
      // el archivo puede estar a mitad de un reemplazo atomico
    }
    await new Promise((done) => setTimeout(done, SAVE_POLL_MS));
  }
  expect(savedFavorites(configDir)).toEqual(expected);
}

const favoritePath = (name: string) => `${SCRATCH_DIR}\\${name}`;

describe('favoritos sobre la ventana real', () => {
  it('agrega con la estrella, reordena con el raton, renombra y sobrevive al reinicio con uno no disponible', async () => {
    FAVORITE_NAMES.forEach((name) =>
      mkdirSync(scratchFolder(name), { recursive: true }),
    );
    const configDir = newConfigDir();
    const userDataDir = mkdtempSync(join(tmpdir(), 'dakedaduck-wv2-fav-'));
    scratchDirs.push(userDataDir);
    const first = await launchStatusApp(configDir, userDataDir);
    const { page } = first;
    expect(await page.locator('.favorites__item').count()).toBe(0);

    for (const name of FAVORITE_NAMES) await starFolder(page, name);
    expect(await favoriteNames(page)).toEqual(FAVORITE_NAMES);
    await first.capture('i10-favoritos-agregados');

    await dragFavorite(page, 'fav-a', 'fav-c');
    await page.waitForFunction(
      () =>
        document.querySelector('.favorites__name')?.textContent?.trim() ===
        'fav-b',
    );
    expect(await favoriteNames(page)).toEqual(['fav-b', 'fav-c', 'fav-a']);
    expect(await currentCrumb(page, 'fav-c').count()).toBe(1);

    await favoriteLink(page, 'fav-b').focus();
    await page.keyboard.press('F2');
    const rename = page.getByRole('textbox', { name: 'Nombre del favorito' });
    await rename.fill(RENAMED);
    await page.keyboard.press('Enter');
    await favoriteLink(page, RENAMED).waitFor();
    await favoriteLink(page, 'fav-c').focus();
    await page.keyboard.press('F2');
    await rename.fill('descartado');
    await page.keyboard.press('Escape');
    await favoriteLink(page, 'fav-c').waitFor();
    expect(await favoriteNames(page)).toEqual([RENAMED, 'fav-c', 'fav-a']);

    const expected = [
      { path: favoritePath('fav-b'), name: RENAMED },
      { path: favoritePath('fav-c'), name: 'fav-c' },
      { path: favoritePath('fav-a'), name: 'fav-a' },
    ];
    await waitForSaved(configDir, expected);
    await expectCleanSession(first);
    await exitGracefully(first);
    session = undefined;
    removeDir(scratchFolder('fav-c'));

    const second = await launchStatusApp(configDir, userDataDir);
    await favoriteLink(second.page, RENAMED).waitFor();
    expect(await favoriteNames(second.page)).toEqual([
      RENAMED,
      'fav-c',
      'fav-a',
    ]);
    expect(await favoriteLink(second.page, 'fav-c').innerText()).toContain(
      UNAVAILABLE_TEXT,
    );
    expect(await favoriteLink(second.page, RENAMED).innerText()).not.toContain(
      UNAVAILABLE_TEXT,
    );
    await captureBothThemes(second, 'i10-favoritos');
    await expectCleanSession(second);
  });

  it('navega la pestaña activa con un favorito, avisa si un favorito no disponible no abre y quita con el boton', async () => {
    FAVORITE_NAMES.forEach((name) =>
      mkdirSync(scratchFolder(name), { recursive: true }),
    );
    const configDir = newConfigDir();
    const config = readJson<Record<string, unknown>>(
      join(configDir, 'config.json'),
    );
    const favorites = FAVORITE_NAMES.map((name) => ({
      path: favoritePath(name),
      name,
    }));
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ ...config, ui: { version: 1, favorites } }),
    );
    removeDir(scratchFolder('fav-b'));
    const app = await launchStatusApp(configDir);
    const { page } = app;
    await favoriteLink(page, 'fav-b').waitFor();
    expect(await favoriteLink(page, 'fav-b').innerText()).toContain(
      UNAVAILABLE_TEXT,
    );

    await favoriteLink(page, 'fav-c').click();
    await currentCrumb(page, 'fav-c').waitFor();
    expect(await page.getByRole('tab').count()).toBe(1);
    expect(
      await toolbarButton(page, 'Marcar como favorita').getAttribute(
        'aria-pressed',
      ),
    ).toBe('true');

    await favoriteLink(page, 'fav-b').click();
    const alert = page.locator(`${EXPLORER} [role="alert"]`);
    await alert.waitFor();
    expect(await alert.innerText()).toContain('No se pudo abrir');
    await currentCrumb(page, 'fav-c').waitFor();
    expect(await favoriteNames(page)).toEqual(FAVORITE_NAMES);

    await page
      .getByRole('button', { name: 'Quitar el favorito fav-b' })
      .click();
    expect(await favoriteNames(page)).toEqual(['fav-a', 'fav-c']);
    await waitForSaved(configDir, [
      { path: favoritePath('fav-a'), name: 'fav-a' },
      { path: favoritePath('fav-c'), name: 'fav-c' },
    ]);
    await expectCleanSession(app);
  });
});

function runSvn(args: string[]): string {
  return execFileSync(
    manifest.svn_path,
    ['--config-dir', manifest.svn_config_dir, '--non-interactive', ...args],
    { encoding: 'utf8' },
  );
}

function checkoutRemote(destination: string): void {
  runSvn([
    'checkout',
    manifest.repo_svn_url,
    destination,
    '--username',
    manifest.user,
    '--password',
    manifest.password,
    '--no-auth-cache',
  ]);
}

function commitFromPeer(): void {
  appendFileSync(join(manifest.peer_wc_path, REMOTE_FILE), 'linea remota\n');
  runSvn([
    'commit',
    manifest.peer_wc_path,
    '-m',
    'cambio remoto desde otra copia',
  ]);
}

async function countDialogOpenings(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as Record<string, number>;
    scope.__dialogOpens = 0;
    new MutationObserver((records) => {
      const nodes = records.flatMap((record) => [...record.addedNodes]);
      scope.__dialogOpens += nodes.filter(
        (node) =>
          node instanceof Element &&
          (node.matches('[role="dialog"]') ||
            node.querySelector('[role="dialog"]')),
      ).length;
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function submitCredentials(page: Page, password: string): Promise<void> {
  await page.locator('#credentials-username').fill(manifest.user);
  await page.locator('#credentials-password').fill(password);
  await page.getByRole('button', { name: 'Reintentar' }).click();
}

describe('comprobar servidor sobre la ventana real', () => {
  it('pide credenciales, las reintenta si fallan y muestra lo modificado en el servidor sin guardar la contraseña', async () => {
    mkdirSync(scratchFolder(), { recursive: true });
    checkoutRemote(scratchFolder(REMOTE_NAME));
    commitFromPeer();
    const configDir = newConfigDir();
    const app = await launchStatusApp(configDir);
    const { page } = app;
    await enter(page, SCRATCH_DIR);
    await enter(page, REMOTE_NAME);
    await entryRow(page, 'Archivo', REMOTE_FILE).waitFor();
    await waitForStatus(page);
    const remoteRow = entryRow(page, 'Archivo', REMOTE_FILE);
    expect(await remoteRow.locator('.svn-badge').count()).toBe(0);

    await countDialogOpenings(page);
    await toolbarButton(page, 'Comprobar servidor').click();
    const dialog = page.getByRole('dialog', {
      name: 'Credenciales requeridas',
    });
    await dialog.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    await captureBothThemes(app, 'i10-comprobar-credenciales');

    await submitCredentials(page, WRONG_PASSWORD);
    await page.waitForFunction(
      () => (window as unknown as Record<string, number>).__dialogOpens >= 2,
      undefined,
      { timeout: VISIBLE_TIMEOUT_MS },
    );
    await dialog.waitFor();
    expect(await page.locator('#credentials-password').inputValue()).toBe('');

    await submitCredentials(page, manifest.password);
    await dialog.waitFor({ state: 'detached', timeout: VISIBLE_TIMEOUT_MS });
    await expectBadge(page, {
      kind: 'Archivo',
      name: REMOTE_FILE,
      state: 'remote',
      label: 'Modificado en el servidor',
    });
    await page
      .getByText(/Estado comparado con el servidor \(revisión \d+\)/)
      .waitFor();
    await remoteRow.scrollIntoViewIfNeeded();
    await captureBothThemes(app, 'i10-comprobar-servidor');

    const everything = await page.evaluate(
      () =>
        `${document.documentElement.outerHTML} ${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`,
    );
    expect(everything).not.toContain(manifest.password);
    expect(everything).not.toContain(WRONG_PASSWORD);
    expect(configText(configDir)).not.toContain(manifest.password);
    await expectCleanSession(app);
  });

  it('no pide credenciales en una copia cuyo servidor no las necesita y marca el progreso', async () => {
    const app = await launchStatusApp();
    const { page } = app;
    await enter(page, WC_NAME);
    await waitForStatus(page);
    await toolbarButton(page, 'Comprobar servidor').click();
    await page
      .getByText(/Estado comparado con el servidor/)
      .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    expect(await page.getByRole('dialog').count()).toBe(0);
    await expectBadge(page, ROOT_EXPECTATIONS[0]);
  });
});
