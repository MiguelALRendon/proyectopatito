import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { installIpcGate } from './ipcGate';
import { runPowerShell } from './pwsh';

const START_SCRIPT = 'scripts/e2e/start-app.ps1';
const DEFAULT_PORT = 9333;
const PAGE_WAIT_MS = 30_000;
const FIND_PAGE_POLL_MS = 250;
const LOOPBACK_URL = 'http://127.0.0.1';
const HTTP_PREFIX = 'http';
const ALLOWED_HOSTS = [
  'tauri.localhost',
  'ipc.localhost',
  'workspace-file.localhost',
];
const DEV_HOSTS = ['localhost:1420'];
const ALLOWED_SCHEMES = ['blob:', 'data:', 'about:'];
const CSP_VIOLATION_KEY = '__cspViolations';
const SCREENSHOT_DIR = resolve('.bossdream-project/screenshots');
const EXIT_POLL_MS = 100;
const PORT_PROBE_MS = 500;

export const HOLD_PING_MS = 2_000;
export const HOLD_KEEPALIVE_MS = 6_000;

export type AppMode = 'debug' | 'release' | 'dev';

export interface LaunchOptions {
  configDir: string;
  mode?: AppMode;
  userDataDir?: string;
  port?: number;
}

export interface AppSession {
  page: Page;
  externalRequests: string[];
  cspViolations: () => Promise<string[]>;
  reload: () => Promise<void>;
  closeMainWindow: () => void;
  isRunning: () => boolean;
  waitForExit: (timeoutMs: number) => Promise<boolean>;
  capture: (name: string) => Promise<string>;
  stop: () => void;
}

interface AppState {
  pid: number;
  port: number;
}

const MODE_ENV = 'E2E_APP_MODE';

function resolveMode(options: LaunchOptions): AppMode {
  return (
    options.mode ?? (process.env[MODE_ENV] as AppMode | undefined) ?? 'debug'
  );
}

function launchArgs(options: LaunchOptions, stateFile: string): string[] {
  const userData =
    options.userDataDir ?? mkdtempSync(join(tmpdir(), 'dakedaduck-wv2-'));
  return [
    '-Mode',
    resolveMode(options),
    '-ConfigDir',
    options.configDir,
    '-UserDataDir',
    userData,
    '-Port',
    String(options.port ?? DEFAULT_PORT),
    '-StateFile',
    stateFile,
  ];
}

export function isAllowedRequest(url: string, mode: AppMode): boolean {
  if (ALLOWED_SCHEMES.some((scheme) => url.startsWith(scheme))) return true;
  const { host } = new URL(url);
  const hosts =
    mode === 'dev' ? [...ALLOWED_HOSTS, ...DEV_HOSTS] : ALLOWED_HOSTS;
  return hosts.includes(host);
}

async function findAppPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + PAGE_WAIT_MS;
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((candidate) =>
      candidate.url().startsWith(HTTP_PREFIX),
    );
    if (page) return page;
    await new Promise((done) => setTimeout(done, FIND_PAGE_POLL_MS));
  }
  throw new Error('La ventana de la aplicacion no expuso ninguna pagina');
}

async function installViolationHook(page: Page): Promise<void> {
  await page.context().addInitScript((key) => {
    const store: string[] = [];
    (window as unknown as Record<string, string[]>)[key] = store;
    document.addEventListener('securitypolicyviolation', (event) => {
      store.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  }, CSP_VIOLATION_KEY);
}

function trackRequests(page: Page, mode: AppMode): string[] {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!isAllowedRequest(request.url(), mode)) external.push(request.url());
  });
  return external;
}

async function connectPage(state: AppState): Promise<[Browser, Page]> {
  const browser = await chromium.connectOverCDP(
    `${LOOPBACK_URL}:${state.port}`,
  );
  return [browser, await findAppPage(browser)];
}

async function captureScreenshot(page: Page, name: string): Promise<string> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isDebugPortOpen(port: number): Promise<boolean> {
  try {
    await fetch(`${LOOPBACK_URL}:${port}/json/version`, {
      signal: AbortSignal.timeout(PORT_PROBE_MS),
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForAppExit(
  state: AppState,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(state.pid) && !(await isDebugPortOpen(state.port))) {
      return true;
    }
    await new Promise((done) => setTimeout(done, EXIT_POLL_MS));
  }
  return false;
}

function stopApp(stateFile: string): void {
  runPowerShell(START_SCRIPT, ['-Stop', '-StateFile', stateFile]);
}

function readCspViolations(page: Page): Promise<string[]> {
  return page.evaluate(
    (key) => (window as unknown as Record<string, string[]>)[key] ?? [],
    CSP_VIOLATION_KEY,
  );
}

async function attachSession(
  state: AppState,
  mode: AppMode,
  stateFile: string,
): Promise<AppSession> {
  const [browser, page] = await connectPage(state);
  await installViolationHook(page);
  await installIpcGate(page.context());
  const externalRequests = trackRequests(page, mode);
  await page.reload();
  return {
    page,
    externalRequests,
    cspViolations: () => readCspViolations(page),
    reload: () => page.reload().then(() => undefined),
    closeMainWindow: () =>
      void runPowerShell(START_SCRIPT, [
        '-CloseWindow',
        '-StateFile',
        stateFile,
      ]),
    isRunning: () => isProcessAlive(state.pid),
    waitForExit: (timeoutMs) => waitForAppExit(state, timeoutMs),
    capture: (name) => captureScreenshot(page, name),
    stop: () => {
      browser.close().catch(() => undefined);
      stopApp(stateFile);
    },
  };
}

export async function launchApp(options: LaunchOptions): Promise<AppSession> {
  const stateFile = join(
    mkdtempSync(join(tmpdir(), 'dakedaduck-state-')),
    's.json',
  );
  const state = JSON.parse(
    runPowerShell(START_SCRIPT, launchArgs(options, stateFile)),
  ) as AppState;
  try {
    return await attachSession(state, resolveMode(options), stateFile);
  } catch (error) {
    stopApp(stateFile);
    throw error;
  }
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
