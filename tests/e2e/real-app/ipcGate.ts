import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from 'playwright-core';

export type IpcRule = 'pass' | 'swallow' | 'cancel';
export type IpcTransport = 'fetch' | 'postMessage';

export interface IpcFake {
  body: unknown;
  isError?: boolean;
  pathSuffix?: string;
  args?: Record<string, unknown>;
}

export interface IpcCall {
  command: string;
  transport: IpcTransport;
  rule: IpcRule | 'fake';
}

interface GatedWindow {
  __ipcGate: {
    rules: Record<string, IpcRule>;
    fakes: Record<string, IpcFake | undefined>;
    calls: IpcCall[];
    isPostMessageWrapped: boolean;
  };
}

export const GATE_SCRIPT = fileURLToPath(
  new URL('./ipcGate.page.js', import.meta.url),
);

export async function installIpcGate(context: BrowserContext): Promise<void> {
  await context.addInitScript({ path: GATE_SCRIPT });
}

export function setIpcRule(
  page: Page,
  command: string,
  rule: IpcRule,
): Promise<void> {
  return page.evaluate(
    ([name, value]) => {
      (window as unknown as GatedWindow).__ipcGate.rules[name] =
        value as IpcRule;
    },
    [command, rule],
  );
}

export function setIpcFake(
  page: Page,
  command: string,
  fake: IpcFake | null,
): Promise<void> {
  return page.evaluate(
    ([name, value]) => {
      const { fakes } = (window as unknown as GatedWindow).__ipcGate;
      if (value) fakes[name as string] = value as IpcFake;
      else delete fakes[name as string];
    },
    [command, fake],
  );
}

export function ipcCalls(page: Page): Promise<IpcCall[]> {
  return page.evaluate(() => [
    ...(window as unknown as GatedWindow).__ipcGate.calls,
  ]);
}

export function isPostMessageGated(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as GatedWindow).__ipcGate.isPostMessageWrapped,
  );
}
