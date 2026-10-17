import { dirname } from 'node:path';
import type { Locator, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import {
  HOLD_KEEPALIVE_MS,
  HOLD_PING_MS,
  launchApp,
  type AppSession,
} from './harness';
import {
  ipcCalls,
  isPostMessageGated,
  setIpcRule,
  type IpcCall,
  type IpcRule,
} from './ipcGate';

const PANEL = '[aria-label="Explorador de archivos"]';
const VISIBLE_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 5_000;
const EXIT_MARGIN_MS = 15_000;
const SETTLE_MS = 750;
const SIDEBAR_HANDLE = 'Redimensionar la barra lateral';
const BOTTOM_HANDLE = 'Redimensionar el panel inferior';
const SIDEBAR_DRAG_PX = 80;
const SIDEBAR_DEFAULT_PX = 240;
const SIDEBAR_MAX_PX = 480;
const BEYOND_MAX_DRAG_PX = 1_000;
const BOTTOM_DRAG_PX = -60;
const BOTTOM_DEFAULT_PX = 160;
const KEYBOARD_STEP_PX = 16;
const IPC_ORIGIN = 'http://ipc.localhost';
const CONFIRM_COMMAND = 'app_confirm_close';
const HOLD_COMMAND = 'app_hold_close';
const MARKETPLACE_NOTICE = 'Disponible en una fase posterior';

interface TauriInternals {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
  transformCallback: (callback: () => void) => number;
}

interface ProbedWindow {
  __TAURI_INTERNALS__: TauriInternals;
  __closeEvents: number;
}

let session: AppSession | undefined;
let manifest: FixtureManifest;
let seedRoot: string;

beforeAll(() => {
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
});

afterEach(() => {
  session?.stop();
  session = undefined;
});

afterAll(() => stopFixtures(seedRoot));

async function launchSeededApp(userDataDir?: string): Promise<AppSession> {
  const app = await launchApp({
    configDir: dirname(manifest.config_path),
    userDataDir,
  });
  session = app;
  await app.page.locator(PANEL).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
  return app;
}

function handleOf(page: Page, name: string): Locator {
  return page.getByRole('separator', { name });
}

async function sizeOf(handle: Locator): Promise<number> {
  return Number(await handle.getAttribute('aria-valuenow'));
}

async function dragBy(
  page: Page,
  handle: Locator,
  offset: { x: number; y: number },
): Promise<void> {
  const box = await handle.boundingBox();
  if (!box) throw new Error('el tirador no tiene caja visible');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + offset.x, start.y + offset.y, { steps: 8 });
  await page.mouse.up();
}

async function widthOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  return Math.round(box?.width ?? 0);
}

async function pressTimes(
  handle: Locator,
  key: string,
  times: number,
): Promise<void> {
  await handle.focus();
  for (let press = 0; press < times; press += 1) {
    await handle.press(key);
  }
}

async function exitGracefully(app: AppSession): Promise<void> {
  app.closeMainWindow();
  expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
}

async function installCloseProbe(page: Page, rule: IpcRule): Promise<void> {
  expect(await isPostMessageGated(page)).toBe(true);
  await setIpcRule(page, CONFIRM_COMMAND, rule);
  await page.evaluate(() => {
    const host = window as unknown as ProbedWindow;
    host.__closeEvents = 0;
    const handler = host.__TAURI_INTERNALS__.transformCallback(() => {
      host.__closeEvents += 1;
    });
    return host.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
      event: 'app://close-requested',
      target: { kind: 'Any' },
      handler,
    });
  });
}

function confirmDecision(page: Page, rule: IpcRule): Promise<void> {
  return setIpcRule(page, CONFIRM_COMMAND, rule);
}

async function failNextIpcFetch(page: Page): Promise<void> {
  await page.evaluate((origin) => {
    const gated = window.fetch;
    let isArmed = true;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (!isArmed || !url.startsWith(origin)) return gated(input, init);
      isArmed = false;
      return Promise.reject(new TypeError('Failed to fetch'));
    };
  }, IPC_ORIGIN);
}

function hasGatedCall(calls: IpcCall[], expected: Partial<IpcCall>): boolean {
  return calls.some((call) =>
    Object.entries(expected).every(
      ([key, value]) => call[key as keyof IpcCall] === value,
    ),
  );
}

async function waitForGatedCall(
  page: Page,
  expected: Partial<IpcCall>,
): Promise<void> {
  await expect
    .poll(async () => hasGatedCall(await ipcCalls(page), expected), {
      timeout: VISIBLE_TIMEOUT_MS,
    })
    .toBe(true);
}

function callInPage(page: Page, command: string): Promise<unknown> {
  return page.evaluate(
    (name) =>
      (window as unknown as ProbedWindow).__TAURI_INTERNALS__.invoke(name),
    command,
  );
}

function pause(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function closeEventsSeen(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as ProbedWindow).__closeEvents);
}

async function holdFor(page: Page, durationMs: number): Promise<void> {
  const until = Date.now() + durationMs;
  while (Date.now() < until) {
    await callInPage(page, HOLD_COMMAND);
    await pause(HOLD_PING_MS);
  }
}

async function waitForCloseEvents(page: Page, expected: number): Promise<void> {
  await page.waitForFunction(
    (count) => (window as unknown as ProbedWindow).__closeEvents >= count,
    expected,
  );
}

describe('shell sobre la ventana real', () => {
  it('Marketplace aparece deshabilitado con su aviso visible', async () => {
    const app = await launchSeededApp();
    const marketplace = app.page.getByRole('button', { name: 'Marketplace' });

    expect(await marketplace.getAttribute('aria-disabled')).toBe('true');
    expect(await marketplace.getAttribute('aria-describedby')).not.toBeNull();
    await app.page.getByText(MARKETPLACE_NOTICE).waitFor({ state: 'visible' });
    await app.page
      .getByRole('navigation', { name: 'Secciones principales' })
      .getByText('Mis archivos')
      .waitFor({ state: 'visible' });
    await app.capture('i7-shell-completo');
    expect(app.externalRequests).toEqual([]);
    expect(await app.cspViolations()).toEqual([]);
  });

  it('los paneles se redimensionan con ratón y teclado y se recuerdan al relanzar', async () => {
    const userData = newScratchDir('dakedaduck-wv2-shell-');
    const first = await launchSeededApp(userData);
    const sidebar = handleOf(first.page, SIDEBAR_HANDLE);
    const bottom = handleOf(first.page, BOTTOM_HANDLE);
    const aside = first.page.getByLabel('Barra lateral', { exact: true });
    expect(await sizeOf(sidebar)).toBe(SIDEBAR_DEFAULT_PX);
    expect(await sizeOf(bottom)).toBe(BOTTOM_DEFAULT_PX);

    const widthBefore = await widthOf(aside);
    await dragBy(first.page, sidebar, { x: SIDEBAR_DRAG_PX, y: 0 });
    expect(await sizeOf(sidebar)).toBe(SIDEBAR_DEFAULT_PX + SIDEBAR_DRAG_PX);
    expect((await widthOf(aside)) - widthBefore).toBe(SIDEBAR_DRAG_PX);

    await dragBy(first.page, sidebar, { x: BEYOND_MAX_DRAG_PX, y: 0 });
    expect(await sizeOf(sidebar)).toBe(SIDEBAR_MAX_PX);
    await pressTimes(sidebar, 'ArrowLeft', 2);
    expect(await sizeOf(sidebar)).toBe(SIDEBAR_MAX_PX - 2 * KEYBOARD_STEP_PX);

    await dragBy(first.page, bottom, { x: 0, y: BOTTOM_DRAG_PX });
    expect(await sizeOf(bottom)).toBe(BOTTOM_DEFAULT_PX - BOTTOM_DRAG_PX);
    await pressTimes(bottom, 'ArrowUp', 1);
    const expected = {
      sidebar: SIDEBAR_MAX_PX - 2 * KEYBOARD_STEP_PX,
      bottom: BOTTOM_DEFAULT_PX - BOTTOM_DRAG_PX + KEYBOARD_STEP_PX,
    };
    expect(await sizeOf(bottom)).toBe(expected.bottom);
    await first.capture('i7-panel-redimensionado');
    await exitGracefully(first);

    const second = await launchSeededApp(userData);
    expect(await sizeOf(handleOf(second.page, SIDEBAR_HANDLE))).toBe(
      expected.sidebar,
    );
    expect(await sizeOf(handleOf(second.page, BOTTOM_HANDLE))).toBe(
      expected.bottom,
    );
  });
});

describe('cierre de la ventana real', () => {
  it('confirmar termina el proceso con el manejador real de la página', async () => {
    const app = await launchSeededApp();
    await installCloseProbe(app.page, 'pass');

    app.closeMainWindow();

    expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
  });

  it('cancelar no cierra y el cierre siguiente sí termina el proceso', async () => {
    const app = await launchSeededApp();
    await installCloseProbe(app.page, 'cancel');

    app.closeMainWindow();
    await waitForCloseEvents(app.page, 1);
    await waitForGatedCall(app.page, { command: CONFIRM_COMMAND });
    await pause(SETTLE_MS);
    expect(app.isRunning()).toBe(true);
    expect(await app.page.locator(PANEL).isVisible()).toBe(true);

    app.closeMainWindow();
    await waitForCloseEvents(app.page, 2);
    expect(app.isRunning()).toBe(true);
    await confirmDecision(app.page, 'pass');
    app.closeMainWindow();
    expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
  });

  it('con latido la decisión sigue viva más allá del tiempo sin latido, hasta confirmar', async () => {
    const app = await launchSeededApp();
    await installCloseProbe(app.page, 'swallow');

    app.closeMainWindow();
    await waitForCloseEvents(app.page, 1);
    await holdFor(app.page, HOLD_KEEPALIVE_MS * 2);
    expect(app.isRunning()).toBe(true);

    await confirmDecision(app.page, 'pass');
    await callInPage(app.page, CONFIRM_COMMAND).catch(() => undefined);
    expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
  });

  it('sin latido Rust cierra la ventana al cumplirse el tiempo sin latido', async () => {
    const app = await launchSeededApp();
    await installCloseProbe(app.page, 'swallow');

    const startedAt = Date.now();
    app.closeMainWindow();
    await waitForCloseEvents(app.page, 1);
    await pause(SETTLE_MS);
    expect(app.isRunning()).toBe(true);

    expect(await app.waitForExit(HOLD_KEEPALIVE_MS + EXIT_MARGIN_MS)).toBe(
      true,
    );
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
      HOLD_KEEPALIVE_MS - SETTLE_MS,
    );
  });

  it('un segundo cierre con la decisión en curso no avisa de nuevo a la página mientras llegue el latido', async () => {
    const app = await launchSeededApp();
    await installCloseProbe(app.page, 'swallow');

    app.closeMainWindow();
    await waitForCloseEvents(app.page, 1);
    await callInPage(app.page, HOLD_COMMAND);

    app.closeMainWindow();
    await holdFor(app.page, CLOSE_TIMEOUT_MS + SETTLE_MS);
    app.closeMainWindow();
    await holdFor(app.page, HOLD_PING_MS);
    expect(await closeEventsSeen(app.page)).toBe(1);
    expect(app.isRunning()).toBe(true);

    await confirmDecision(app.page, 'pass');
    await callInPage(app.page, CONFIRM_COMMAND).catch(() => undefined);
    expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
  });

  it('pedir cerrar una ventana cuyo proceso ya terminó no falla', async () => {
    const app = await launchSeededApp();
    await installCloseProbe(app.page, 'pass');
    await exitGracefully(app);

    expect(() => app.closeMainWindow()).not.toThrow();
  });

  it('no lanza una segunda instancia sobre un puerto de depuración ocupado', async () => {
    const app = await launchSeededApp();

    await expect(
      launchApp({ configDir: dirname(manifest.config_path) }),
    ).rejects.toThrow(/ya responde/);
    expect(app.isRunning()).toBe(true);
    expect(await app.page.locator(PANEL).isVisible()).toBe(true);
  });

  it('si la página no responde, Rust cierra la ventana al cumplirse el tiempo máximo', async () => {
    const app = await launchSeededApp();
    await installCloseProbe(app.page, 'swallow');
    await setIpcRule(app.page, HOLD_COMMAND, 'swallow');

    const startedAt = Date.now();
    app.closeMainWindow();
    await waitForCloseEvents(app.page, 1);
    expect(app.isRunning()).toBe(true);

    expect(await app.waitForExit(CLOSE_TIMEOUT_MS + EXIT_MARGIN_MS)).toBe(true);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
      CLOSE_TIMEOUT_MS - SETTLE_MS,
    );
  });

  it('una confirmación sin solicitud de cierre no cierra la ventana', async () => {
    const app = await launchSeededApp();
    await installCloseProbe(app.page, 'pass');

    await callInPage(app.page, CONFIRM_COMMAND);
    await pause(SETTLE_MS);

    expect(app.isRunning()).toBe(true);
    expect(await app.page.locator(PANEL).isVisible()).toBe(true);
  });

  it('el envoltorio gobierna también el transporte de respaldo postMessage', async () => {
    const app = await launchSeededApp();
    await installCloseProbe(app.page, 'swallow');
    await failNextIpcFetch(app.page);
    await callInPage(app.page, HOLD_COMMAND);
    await waitForGatedCall(app.page, {
      command: HOLD_COMMAND,
      transport: 'postMessage',
    });

    app.closeMainWindow();
    await waitForCloseEvents(app.page, 1);
    await waitForGatedCall(app.page, {
      command: CONFIRM_COMMAND,
      transport: 'postMessage',
      rule: 'swallow',
    });
    await pause(SETTLE_MS);
    expect(app.isRunning()).toBe(true);

    await confirmDecision(app.page, 'pass');
    await callInPage(app.page, CONFIRM_COMMAND).catch(() => undefined);
    expect(await app.waitForExit(EXIT_MARGIN_MS)).toBe(true);
  });
});
