import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const calls: string[] = [];
let closeHandler: (() => void) | undefined;
const unlisten = vi.fn();
const listenFails = { value: false };

vi.mock('../services/tauri', () => ({
  appFrontendReady: vi.fn(async () => void calls.push('ready')),
  appHoldClose: vi.fn(async () => void calls.push('hold')),
  appConfirmClose: vi.fn(async () => void calls.push('confirm')),
  appCancelClose: vi.fn(async () => void calls.push('cancel')),
  onCloseRequested: vi.fn(async (handler: () => void) => {
    if (listenFails.value) throw new Error('listen failed');
    calls.push('listen');
    closeHandler = handler;
    return unlisten;
  }),
}));

import {
  appConfirmClose,
  appFrontendReady,
  appHoldClose,
  onCloseRequested,
} from '../services/tauri';
import { resolveChoice, useChoice } from './useChoice';
import {
  HOLD_PING_MS,
  handleCloseRequested,
  registerCloseGuard,
  startWindowClose,
  useWindowClose,
  type CloseGuard,
} from './useWindowClose';

const registered: Array<() => void> = [];
const { request } = useChoice();
const MINUTES_PAST_THE_OLD_LIMIT = 11;
const MS_PER_MINUTE = 60_000;

function guard(check: CloseGuard): CloseGuard {
  registered.push(registerCloseGuard(check));
  return check;
}

beforeEach(() => {
  calls.length = 0;
  closeHandler = undefined;
  listenFails.value = false;
  unlisten.mockReset();
  vi.mocked(appHoldClose).mockImplementation(
    async () => void calls.push('hold'),
  );
});

afterEach(() => {
  registered.splice(0).forEach((remove) => remove());
  resolveChoice(null);
  vi.useRealTimers();
});

describe('handleCloseRequested guards', () => {
  it('asks the user instead of closing in silence when a guard throws', async () => {
    guard(() => {
      throw new Error('boom');
    });
    const pending = handleCloseRequested();
    await flushPromises();
    expect(request.value?.title).toBe(
      'No se pudo comprobar si hay cambios sin guardar',
    );
    expect(calls).toEqual(['hold']);
    resolveChoice('close-anyway');
    await pending;
    expect(calls).toEqual(['hold', 'confirm']);
  });

  it('keeps the window open when the user cancels after a guard failure', async () => {
    guard(() => Promise.reject(new Error('boom')));
    const pending = handleCloseRequested();
    await flushPromises();
    resolveChoice('cancel');
    await pending;
    expect(calls).toEqual(['hold', 'cancel']);
  });

  it('treats Escape on the failure dialog as cancel', async () => {
    guard(() => {
      throw new Error('boom');
    });
    const pending = handleCloseRequested();
    await flushPromises();
    resolveChoice(null);
    await pending;
    expect(calls).toEqual(['hold', 'cancel']);
  });

  it('cancels without confirming when a guard vetoes', async () => {
    guard(() => false);
    await handleCloseRequested();
    expect(calls).toEqual(['hold', 'cancel']);
  });

  it('stops asking guards after the first veto', async () => {
    const second = vi.fn(() => true);
    guard(() => false);
    guard(second);
    await handleCloseRequested();
    expect(second).not.toHaveBeenCalled();
  });

  it('holds the close before a slow guard so Rust does not time out', async () => {
    let answer: (value: boolean) => void = () => undefined;
    guard(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const pending = handleCloseRequested();
    await flushPromises();
    expect(calls).toEqual(['hold']);
    answer(true);
    await pending;
    expect(calls).toEqual(['hold', 'confirm']);
  });

  it('does not consult a guard that was unregistered', async () => {
    const removed = vi.fn(() => false);
    registerCloseGuard(removed)();
    await handleCloseRequested();
    expect(removed).not.toHaveBeenCalled();
    expect(calls).toEqual(['confirm']);
  });

  it('lets every guard approve before confirming', async () => {
    guard(() => true);
    guard(async () => true);
    await handleCloseRequested();
    expect(calls).toEqual(['hold', 'confirm']);
  });

  it('still runs the guards and confirms when the hold is rejected', async () => {
    guard(() => true);
    vi.mocked(appHoldClose).mockRejectedValueOnce(new Error('ipc down'));
    await handleCloseRequested();
    expect(calls).toEqual(['confirm']);
  });

  it('still honours a veto when the hold is rejected', async () => {
    guard(() => false);
    vi.mocked(appHoldClose).mockRejectedValueOnce(new Error('ipc down'));
    await handleCloseRequested();
    expect(calls).toEqual(['cancel']);
  });

  it('propagates a failing confirmation to the caller', async () => {
    vi.mocked(appConfirmClose).mockRejectedValueOnce(new Error('ipc down'));
    await expect(handleCloseRequested()).rejects.toThrow('ipc down');
  });
});

describe('handleCloseRequested heartbeat', () => {
  const holds = () => calls.filter((call) => call === 'hold').length;

  async function settle(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it('keeps holding every ping while a guard waits and never closes by itself past the old ten minute limit', async () => {
    vi.useFakeTimers();
    let answer: (value: boolean) => void = () => undefined;
    guard(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const pending = handleCloseRequested();
    await settle(MINUTES_PAST_THE_OLD_LIMIT * MS_PER_MINUTE);
    expect(calls).not.toContain('confirm');
    expect(calls).not.toContain('cancel');
    const expectedPings = Math.floor(
      (MINUTES_PAST_THE_OLD_LIMIT * MS_PER_MINUTE) / HOLD_PING_MS,
    );
    expect(holds()).toBe(1 + expectedPings);
    answer(true);
    await pending;
    expect(calls[calls.length - 1]).toBe('confirm');
  });

  it('does not send another hold before a full ping has passed', async () => {
    vi.useFakeTimers();
    let answer: (value: boolean) => void = () => undefined;
    guard(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const pending = handleCloseRequested();
    await settle(HOLD_PING_MS - 1);
    expect(holds()).toBe(1);
    await settle(1);
    expect(holds()).toBe(2);
    answer(true);
    await pending;
  });

  it('stops pinging once the guard answers and leaves no timer behind', async () => {
    vi.useFakeTimers();
    let answer: (value: boolean) => void = () => undefined;
    guard(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const pending = handleCloseRequested();
    await settle(HOLD_PING_MS * 3);
    answer(false);
    await pending;
    const sent = holds();
    await settle(HOLD_PING_MS * 3);
    expect(holds()).toBe(sent);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps pinging while the failure dialog is open', async () => {
    vi.useFakeTimers();
    guard(() => {
      throw new Error('boom');
    });
    const pending = handleCloseRequested();
    await settle(HOLD_PING_MS * 3);
    expect(holds()).toBe(4);
    resolveChoice('close-anyway');
    await pending;
    expect(calls[calls.length - 1]).toBe('confirm');
  });

  it('a failing ping does not break the decision', async () => {
    vi.useFakeTimers();
    let answer: (value: boolean) => void = () => undefined;
    guard(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const pending = handleCloseRequested();
    vi.mocked(appHoldClose).mockRejectedValue(new Error('ipc down'));
    await settle(HOLD_PING_MS * 2);
    answer(true);
    await pending;
    expect(calls[calls.length - 1]).toBe('confirm');
  });

  it('a guard that answers at once leaves no timer behind', async () => {
    vi.useFakeTimers();
    guard(async () => true);
    await handleCloseRequested();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('handleCloseRequested while a request is in flight', () => {
  it('shares the running request instead of asking the guards twice', async () => {
    let answer: (value: boolean) => void = () => undefined;
    const slow = vi.fn(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
    );
    guard(slow);
    const first = handleCloseRequested();
    const second = handleCloseRequested();
    await flushPromises();
    answer(true);
    await Promise.all([first, second]);
    expect(slow).toHaveBeenCalledOnce();
    expect(calls).toEqual(['hold', 'confirm']);
  });

  it('starts a fresh request once the previous one settled', async () => {
    const check = vi.fn(() => true);
    guard(check);
    await handleCloseRequested();
    await handleCloseRequested();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh request after the previous one failed', async () => {
    vi.mocked(appConfirmClose).mockRejectedValueOnce(new Error('ipc down'));
    await expect(handleCloseRequested()).rejects.toThrow('ipc down');
    await handleCloseRequested();
    expect(calls).toEqual(['confirm']);
  });
});

describe('startWindowClose', () => {
  it('listens before announcing the frontend as ready', async () => {
    await startWindowClose();
    expect(calls).toEqual(['listen', 'ready']);
  });

  it('never announces readiness when the listener cannot be registered', async () => {
    listenFails.value = true;
    await expect(startWindowClose()).rejects.toThrow('listen failed');
    expect(calls).toEqual([]);
  });

  it('confirms when the event arrives and nothing is pending', async () => {
    await startWindowClose();
    closeHandler?.();
    await flushPromises();
    expect(calls).toEqual(['listen', 'ready', 'confirm']);
  });

  it('keeps the window open when the event meets a vetoing guard', async () => {
    guard(() => false);
    await startWindowClose();
    closeHandler?.();
    await flushPromises();
    expect(calls).toEqual(['listen', 'ready', 'hold', 'cancel']);
  });

  it('swallows a failing close handler because Rust times out on its own', async () => {
    vi.mocked(appConfirmClose).mockRejectedValueOnce(new Error('ipc down'));
    await startWindowClose();
    closeHandler?.();
    await flushPromises();
    expect(calls).toEqual(['listen', 'ready']);
  });

  it('releases the listener when announcing readiness fails', async () => {
    vi.mocked(appFrontendReady).mockRejectedValueOnce(new Error('ipc down'));
    await expect(startWindowClose()).rejects.toThrow('ipc down');
    expect(unlisten).toHaveBeenCalledOnce();
  });
});

describe('useWindowClose', () => {
  const Host = defineComponent({
    setup() {
      useWindowClose();
      return () => null;
    },
  });

  it('announces readiness on mount and stops listening on unmount', async () => {
    const wrapper = mount(Host);
    await flushPromises();
    expect(calls).toEqual(['listen', 'ready']);
    wrapper.unmount();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('releases the listener when the host unmounts before startup resolves', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(onCloseRequested).mockImplementationOnce(async (handler) => {
      await gate;
      closeHandler = handler;
      return unlisten;
    });
    const wrapper = mount(Host);
    wrapper.unmount();
    expect(unlisten).not.toHaveBeenCalled();
    release();
    await flushPromises();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('releases the listener once even when the unmount comes after startup', async () => {
    const wrapper = mount(Host);
    await flushPromises();
    wrapper.unmount();
    await flushPromises();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('survives a failing startup without an unhandled rejection', async () => {
    listenFails.value = true;
    const wrapper = mount(Host);
    await flushPromises();
    expect(() => wrapper.unmount()).not.toThrow();
    expect(unlisten).not.toHaveBeenCalled();
  });
});
