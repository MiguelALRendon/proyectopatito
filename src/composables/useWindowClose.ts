import { onBeforeUnmount, onMounted } from 'vue';
import { askCloseAnyway } from '../documents/dialogs';
import {
  appCancelClose,
  appConfirmClose,
  appFrontendReady,
  appHoldClose,
  onCloseRequested,
} from '../services/tauri';

export type CloseGuard = () => boolean | Promise<boolean>;

export const HOLD_PING_MS = 2_000;

const guards = new Set<CloseGuard>();
let inFlight: Promise<void> | null = null;

export function registerCloseGuard(guard: CloseGuard): () => void {
  guards.add(guard);
  return () => guards.delete(guard);
}

async function guardAllowsClose(guard: CloseGuard): Promise<boolean> {
  try {
    return await guard();
  } catch {
    return askCloseAnyway();
  }
}

async function guardsAllowClose(): Promise<boolean> {
  for (const guard of [...guards]) {
    if (!(await guardAllowsClose(guard))) return false;
  }
  return true;
}

async function sendHold(): Promise<void> {
  try {
    await appHoldClose();
  } catch {
    return;
  }
}

async function startHoldHeartbeat(): Promise<() => void> {
  await sendHold();
  const timer = setInterval(() => void sendHold(), HOLD_PING_MS);
  return () => clearInterval(timer);
}

async function decideWithHeartbeat(): Promise<boolean> {
  if (guards.size === 0) return true;
  const stopHeartbeat = await startHoldHeartbeat();
  try {
    return await guardsAllowClose();
  } finally {
    stopHeartbeat();
  }
}

async function runCloseRequest(): Promise<void> {
  if (await decideWithHeartbeat()) await appConfirmClose();
  else await appCancelClose();
}

export function handleCloseRequested(): Promise<void> {
  inFlight ??= runCloseRequest().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function startWindowClose(): Promise<() => void> {
  const unlisten = await onCloseRequested(() => {
    handleCloseRequested().catch(() => undefined);
  });
  try {
    await appFrontendReady();
  } catch (error) {
    unlisten();
    throw error;
  }
  return unlisten;
}

export function useWindowClose(): void {
  let isUnmounted = false;
  let unlisten: (() => void) | undefined;
  onMounted(() => {
    startWindowClose()
      .then((stop) => {
        if (isUnmounted) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
  });
  onBeforeUnmount(() => {
    isUnmounted = true;
    unlisten?.();
  });
}
