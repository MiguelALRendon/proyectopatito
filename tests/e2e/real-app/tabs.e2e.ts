import {
  existsSync,
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
import { launchApp, type AppSession } from './harness';

const PANEL = '[aria-label="Explorador de archivos"]';
const VISIBLE_TIMEOUT_MS = 30_000;
const EXIT_MARGIN_MS = 15_000;
const TABS_DIR = 'e2e-tabs';
const ROOT_TITLE = 'Mis archivos';
const UI_VERSION = 1;
const DRAG_STEPS = 12;
const DROP_EDGE_INSET_PX = 4;
const OMITTED_NOTICE = 'Se omitió 1 pestaña de la sesión anterior';
const EMPTY_NOTICE = 'No hay pestañas abiertas';
const OVERFLOW_TAB_COUNT = 14;
const THEMES = ['light', 'dark'] as const;
const CLEANUP_RETRIES = 5;
const CLEANUP_RETRY_DELAY_MS = 200;

interface SavedTab {
  id: string;
  kind: string;
  path: string;
  title: string;
}

interface SavedUi {
  tabs: SavedTab[];
  active_tab: string | null;
}

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
  removeDir(join(manifest.workspace_root, TABS_DIR));
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

function trackScratch(dir: string): string {
  scratchDirs.push(dir);
  return dir;
}

function tabFolder(name: string): string {
  return join(manifest.workspace_root, TABS_DIR, name);
}

function savedTab(name: string): SavedTab {
  const path = `${TABS_DIR}\\${name}`;
  return { id: `e2e-${name}`, kind: 'folder', path, title: name };
}

function prepareConfig(names: string[], active?: string): string {
  names.forEach((name) => mkdirSync(tabFolder(name), { recursive: true }));
  const config = readJson(manifest.config_path);
  const tabs = names.map(savedTab);
  const activeTab = active ? `e2e-${active}` : (tabs[0]?.id ?? null);
  const ui = { version: UI_VERSION, tabs, active_tab: activeTab };
  const dir = trackScratch(mkdtempSync(join(tmpdir(), 'dakedaduck-cfg-tabs-')));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify(names.length > 0 ? { ...config, ui } : config),
  );
  return dir;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function savedUi(configDir: string): SavedUi {
  const config = readJson(join(configDir, 'config.json'));
  return config.ui as SavedUi;
}

async function launchTabsApp(
  configDir: string,
  userDataDir?: string,
): Promise<AppSession> {
  const app = await launchApp({ configDir, userDataDir });
  session = app;
  await app.page.getByRole('tablist').waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  return app;
}

async function tabNames(page: Page): Promise<string[]> {
  return page
    .getByRole('tab')
    .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('aria-label')!));
}

function tabByName(page: Page, name: string): Locator {
  return page.getByRole('tab', { name, exact: true });
}

function menuItem(page: Page, label: string): Locator {
  const text = page.getByText(label, { exact: true });
  return page.getByRole('menuitem').filter({ has: text });
}

async function chooseFromMenu(
  page: Page,
  tab: Locator,
  label: string,
): Promise<void> {
  await tab.click({ button: 'right' });
  await menuItem(page, label).click();
}

async function dragTabOnto(
  page: Page,
  source: Locator,
  target: Locator,
  side: 'before' | 'after',
): Promise<void> {
  const from = await centerOf(source);
  const box = await boxOf(target.locator('xpath=..'));
  const toX =
    side === 'after'
      ? box.x + box.width - DROP_EDGE_INSET_PX
      : box.x + DROP_EDGE_INSET_PX;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(toX, from.y, { steps: DRAG_STEPS });
  await page.mouse.up();
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('la pestaña no tiene caja visible');
  return box;
}

async function centerOf(locator: Locator) {
  const box = await boxOf(locator);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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

describe('pestañas sobre la ventana real', () => {
  it('abre la raiz con «+», no la duplica, y duplica y cierra desde el menu contextual', async () => {
    const app = await launchTabsApp(prepareConfig([]));
    const { page } = app;
    await page.locator(PANEL).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
    expect(await tabNames(page)).toEqual([ROOT_TITLE]);

    await page
      .getByRole('button', { name: `Cerrar pestaña ${ROOT_TITLE}` })
      .click();
    await page.getByText(EMPTY_NOTICE).waitFor();
    expect(await tabNames(page)).toEqual([]);

    const add = page.getByRole('button', {
      name: /Abrir Mis archivos en una pestaña/,
    });
    await add.click();
    await add.click();
    expect(await tabNames(page)).toEqual([ROOT_TITLE]);

    await chooseFromMenu(page, tabByName(page, ROOT_TITLE).first(), 'Duplicar');
    expect(await tabNames(page)).toEqual([ROOT_TITLE, ROOT_TITLE]);
    await app.capture('i8-varias-pestanas');

    await page.getByRole('tab').first().click({ button: 'right' });
    await app.capture('i8-menu-contextual');
    await menuItem(page, 'Cerrar').click();
    expect(await tabNames(page)).toEqual([ROOT_TITLE]);
    await expectCleanSession(app);
  });

  it('deja capturas del aspecto de las pestañas y del menu en ambos temas', async () => {
    const app = await launchTabsApp(
      prepareConfig(['alfa', 'beta', 'gamma', 'delta'], 'beta'),
    );
    const { page } = app;
    await tabByName(page, 'delta').hover();
    await captureBothThemes(app, 'i8b-pestanas-hover');
    await tabByName(page, 'gamma').click({ button: 'right' });
    await menuItem(page, 'Cerrar otras').hover();
    await captureBothThemes(app, 'i8b-menu-contextual');
    await expectCleanSession(app);
  });

  it('desplaza las pestañas en horizontal sin sacar el boton «+» de la vista', async () => {
    const names = Array.from(
      { length: OVERFLOW_TAB_COUNT },
      (_, index) => `carpeta-${index}`,
    );
    const app = await launchTabsApp(prepareConfig(names));
    const add = app.page.getByRole('button', { name: /Abrir Mis archivos/ });
    await add.waitFor();
    await tabByName(app.page, names[0]).focus();
    await app.page.keyboard.press('End');
    const last = tabByName(app.page, names[names.length - 1]);
    expect(await last.evaluate((tab) => tab === document.activeElement)).toBe(
      true,
    );
    expect(await last.isVisible()).toBe(true);
    expect(await add.isVisible()).toBe(true);
    await captureBothThemes(app, 'i8b-pestanas-desbordadas');
    await expectCleanSession(app);
  });

  it('cierra las otras pestañas desde el menu contextual', async () => {
    const app = await launchTabsApp(prepareConfig(['alfa', 'beta', 'gamma']));
    await chooseFromMenu(app.page, tabByName(app.page, 'beta'), 'Cerrar otras');
    expect(await tabNames(app.page)).toEqual(['beta']);
    expect(
      await tabByName(app.page, 'beta').getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('cierra las pestañas a la derecha y deja activa la ancla si la activa estaba a la derecha', async () => {
    const app = await launchTabsApp(
      prepareConfig(['alfa', 'beta', 'gamma', 'delta'], 'delta'),
    );
    await chooseFromMenu(
      app.page,
      tabByName(app.page, 'beta'),
      'Cerrar a la derecha',
    );
    expect(await tabNames(app.page)).toEqual(['alfa', 'beta']);
    expect(
      await tabByName(app.page, 'beta').getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('cierra con el boton, con el clic central y con Supr', async () => {
    const app = await launchTabsApp(
      prepareConfig(['alfa', 'beta', 'gamma', 'delta']),
    );
    const { page } = app;
    await page.getByRole('button', { name: 'Cerrar pestaña alfa' }).click();
    expect(await tabNames(page)).toEqual(['beta', 'gamma', 'delta']);
    await tabByName(page, 'beta').click({ button: 'middle' });
    expect(await tabNames(page)).toEqual(['gamma', 'delta']);
    await tabByName(page, 'gamma').focus();
    await page.keyboard.press('Delete');
    expect(await tabNames(page)).toEqual(['delta']);
  });

  it('reordena arrastrando con el raton real sin navegar la ventana', async () => {
    const app = await launchTabsApp(prepareConfig(['alfa', 'beta', 'gamma']));
    const { page } = app;
    const urlBefore = page.url();

    await dragTabOnto(
      page,
      tabByName(page, 'alfa'),
      tabByName(page, 'gamma'),
      'after',
    );
    expect(await tabNames(page)).toEqual(['beta', 'gamma', 'alfa']);

    await dragTabOnto(
      page,
      tabByName(page, 'alfa'),
      tabByName(page, 'beta'),
      'before',
    );
    expect(await tabNames(page)).toEqual(['alfa', 'beta', 'gamma']);
    expect(page.url()).toBe(urlBefore);
    await expectCleanSession(app);
  });

  it('reordena con Ctrl+Mayus+flechas', async () => {
    const app = await launchTabsApp(prepareConfig(['alfa', 'beta', 'gamma']));
    const alfa = tabByName(app.page, 'alfa');
    await alfa.focus();
    await expect
      .poll(() => alfa.evaluate((tab) => tab === document.activeElement))
      .toBe(true);
    await app.page.keyboard.press('Control+Shift+ArrowRight');
    await expect
      .poll(() => tabNames(app.page))
      .toEqual(['beta', 'alfa', 'gamma']);
  });

  it('vacia lo pendiente al cerrar la ventana y restaura el orden y la activa con el mismo perfil', async () => {
    const configDir = prepareConfig(['alfa', 'beta', 'gamma']);
    const userData = trackScratch(newScratchDir('dakedaduck-wv2-tabs-'));
    const first = await launchTabsApp(configDir, userData);
    await dragTabOnto(
      first.page,
      tabByName(first.page, 'alfa'),
      tabByName(first.page, 'gamma'),
      'after',
    );
    await tabByName(first.page, 'beta').click();
    await chooseFromMenu(first.page, tabByName(first.page, 'beta'), 'Duplicar');
    expect(await tabNames(first.page)).toEqual([
      'beta',
      'beta',
      'gamma',
      'alfa',
    ]);
    await exitGracefully(first);

    const saved = savedUi(configDir);
    expect(saved.tabs.map((tab) => tab.title)).toEqual([
      'beta',
      'beta',
      'gamma',
      'alfa',
    ]);

    const second = await launchTabsApp(configDir, userData);
    expect(await tabNames(second.page)).toEqual([
      'beta',
      'beta',
      'gamma',
      'alfa',
    ]);
    const selected = second.page.locator('[role="tab"][aria-selected="true"]');
    expect(await selected.count()).toBe(1);
    expect(await selected.getAttribute('id')).toBe(`tab-${saved.active_tab}`);
    await second.capture('i8-sesion-restaurada');
    await expectCleanSession(second);
  });

  it('avisa y omite la pestaña cuya ruta ya no existe', async () => {
    const configDir = prepareConfig(['alfa', 'beta', 'gamma'], 'gamma');
    const first = await launchTabsApp(configDir);
    await exitGracefully(first);
    rmSync(tabFolder('beta'), { recursive: true, force: true });
    expect(existsSync(tabFolder('beta'))).toBe(false);

    const second = await launchTabsApp(configDir);
    const { page } = second;
    expect(await tabNames(page)).toEqual(['alfa', 'gamma']);
    const status = page.getByRole('status').filter({ hasText: OMITTED_NOTICE });
    await status.waitFor();
    expect(await tabByName(page, 'gamma').getAttribute('aria-selected')).toBe(
      'true',
    );
    await second.capture('i8-aviso-ruta-inexistente');

    await status.getByRole('button', { name: 'Entendido' }).click();
    expect(await page.getByText(OMITTED_NOTICE).count()).toBe(0);
    await expectCleanSession(second);
  });

  it('abre la raiz cuando todas las pestañas guardadas dejaron de existir', async () => {
    const configDir = prepareConfig(['alfa']);
    const first = await launchTabsApp(configDir);
    await exitGracefully(first);
    rmSync(tabFolder('alfa'), { recursive: true, force: true });

    const second = await launchTabsApp(configDir);
    expect(await tabNames(second.page)).toEqual([ROOT_TITLE]);
    await second.page.getByText(OMITTED_NOTICE).waitFor();
    await second.page.locator(PANEL).waitFor();
  });
});
