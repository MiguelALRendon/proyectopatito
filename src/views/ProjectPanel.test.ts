import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';

vi.mock('../services/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/tauri')>()),
  wcInfo: vi.fn(),
  wcStatus: vi.fn(),
  wcNeedsCleanup: vi.fn(),
  runOperation: vi.fn(),
  opCancel: vi.fn(),
  wcUpdate: vi.fn(),
  wcCleanup: vi.fn(),
}));

import * as service from '../services/tauri';
import type { OperationResult } from '../services/tauri';
import { resolveConfirm, useConfirm } from '../composables/useConfirm';
import { useProjectStore } from '../stores/project';
import ProjectPanel from './ProjectPanel.vue';

const OPERATION_ID = 11;
const okResult: OperationResult = { status: 'ok', revision: 6 };
const errResult = (kind: string): OperationResult =>
  ({
    status: 'err',
    kind,
    message: `error ${kind}`,
    codes: [],
    detail: null,
  }) as OperationResult;

let wrapper: VueWrapper;

async function mountOpenPanel(copyRoot: string | null = 'wc') {
  const pinia = createPinia();
  wrapper = mount(ProjectPanel, {
    props: { copyRoot },
    global: { plugins: [pinia] },
    attachTo: document.body,
  });
  await useProjectStore(pinia).open('wc');
  await flushPromises();
}

function button(label: string) {
  return wrapper.findAll('button').find((item) => item.text() === label);
}

function finishWith(result: OperationResult) {
  vi.mocked(service.runOperation).mockImplementation(async (start) => {
    await start();
    return result;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(service.wcInfo).mockResolvedValue({
    path: 'wc',
    url: 'https://h/r',
    revision: 5,
    last_changed_author: 'alice',
    last_changed_date: null,
  } as service.InfoEntry);
  vi.mocked(service.wcStatus).mockResolvedValue({
    entries: [],
    against_revision: null,
  });
  vi.mocked(service.wcNeedsCleanup).mockResolvedValue(false);
  vi.mocked(service.wcUpdate).mockResolvedValue(OPERATION_ID);
  vi.mocked(service.wcCleanup).mockResolvedValue(OPERATION_ID);
});

afterEach(() => {
  wrapper.unmount();
  document.body.innerHTML = '';
});

describe('ProjectPanel cleanup', () => {
  it('offers Cleanup and its warning after a cancellation that marked the copy', async () => {
    vi.mocked(service.wcNeedsCleanup).mockResolvedValue(true);
    finishWith(errResult('cancelled'));
    await mountOpenPanel();
    await button('Actualizar')?.trigger('click');
    await flushPromises();
    expect(button('Cleanup')).toBeDefined();
    expect(wrapper.text()).toContain('Ejecuta Cleanup antes de continuar.');
  });

  it('does not offer Cleanup after a cancellation that never touched the copy', async () => {
    finishWith(errResult('cancelled'));
    await mountOpenPanel();
    await button('Actualizar')?.trigger('click');
    await flushPromises();
    expect(button('Cleanup')).toBeUndefined();
    expect(wrapper.text()).toContain('La última operación fue cancelada.');
    expect(wrapper.text()).not.toContain('Ejecuta Cleanup');
  });
});

describe('ProjectPanel credentials', () => {
  it('asks for credentials after auth_required and retries with the typed ones', async () => {
    finishWith(errResult('auth_required'));
    await mountOpenPanel();
    await button('Actualizar')?.trigger('click');
    await flushPromises();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Credenciales requeridas');
    const user = document.getElementById('credentials-username');
    const secret = document.getElementById('credentials-password');
    (user as HTMLInputElement).value = 'alice';
    user?.dispatchEvent(new Event('input'));
    (secret as HTMLInputElement).value = 'clave';
    secret?.dispatchEvent(new Event('input'));
    finishWith({ status: 'ok', revision: 6 });
    dialog?.querySelector('form')?.dispatchEvent(new Event('submit'));
    await flushPromises();
    expect(service.wcUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ username: 'alice', password: 'clave' }),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('ProjectPanel busy state', () => {
  it('blocks the actions while an operation runs and cancels it after confirmation', async () => {
    let release: (result: OperationResult) => void = () => undefined;
    vi.mocked(service.runOperation).mockImplementation(async (start) => {
      await start();
      return new Promise<OperationResult>((resolve) => (release = resolve));
    });
    await mountOpenPanel();
    await button('Actualizar')?.trigger('click');
    await flushPromises();
    for (const label of [
      'Actualizar',
      'Confirmar',
      'Refrescar estado',
      'Hacer checkout',
    ]) {
      expect(button(label)?.attributes('disabled')).toBeDefined();
    }
    await button('Cancelar operación')?.trigger('click');
    resolveConfirm(true);
    await flushPromises();
    expect(service.opCancel).toHaveBeenCalledWith(OPERATION_ID);
    release(errResult('cancelled'));
    await flushPromises();
    expect(button('Actualizar')?.attributes('disabled')).toBeUndefined();
  });
});

describe('ProjectPanel cancel confirmation', () => {
  let release: (result: OperationResult) => void = () => undefined;

  function runUntilStarted() {
    vi.mocked(service.runOperation).mockImplementation(async (start) => {
      await start();
      return new Promise<OperationResult>((resolve) => (release = resolve));
    });
  }

  it('does not cancel when the user rejects the confirmation', async () => {
    runUntilStarted();
    await mountOpenPanel();
    await button('Actualizar')?.trigger('click');
    await flushPromises();
    await button('Cancelar operación')?.trigger('click');
    resolveConfirm(false);
    await flushPromises();
    expect(service.opCancel).not.toHaveBeenCalled();
    release(okResult);
    await flushPromises();
  });

  it('keeps Cancelar disabled until the backend assigns an operation id', async () => {
    vi.mocked(service.runOperation).mockImplementation(
      () => new Promise<OperationResult>((resolve) => (release = resolve)),
    );
    await mountOpenPanel();
    await button('Actualizar')?.trigger('click');
    await flushPromises();
    expect(button('Cancelar operación')?.attributes('disabled')).toBeDefined();
    release(okResult);
    await flushPromises();
  });

  it('drops a pending confirmation when the operation ends by itself', async () => {
    runUntilStarted();
    await mountOpenPanel();
    await button('Actualizar')?.trigger('click');
    await flushPromises();
    await button('Cancelar operación')?.trigger('click');
    expect(useConfirm().message.value).not.toBeNull();
    release(okResult);
    await flushPromises();
    expect(useConfirm().message.value).toBeNull();
    expect(service.opCancel).not.toHaveBeenCalled();
  });
});

describe('ProjectPanel without the open form', () => {
  it('no longer asks for a path to open a copy', async () => {
    await mountOpenPanel();
    expect(wrapper.find('#open-path').exists()).toBe(false);
    expect(button('Abrir')).toBeUndefined();
    expect(button('Elegir carpeta')).toBeUndefined();
  });

  it('keeps the checkout form available with no copy at all', async () => {
    await mountOpenPanel(null);
    expect(wrapper.find('#checkout-url').exists()).toBe(true);
    expect(wrapper.text()).toContain('no es una copia de trabajo');
    expect(button('Actualizar')).toBeUndefined();
  });
});

describe('ProjectPanel copy card', () => {
  it('shows the card only for the copy the explorer is looking at', async () => {
    await mountOpenPanel('wc');
    expect(button('Actualizar')).toBeDefined();
    await wrapper.setProps({ copyRoot: 'otra' });
    expect(button('Actualizar')).toBeUndefined();
  });

  it('offers a highlighted Cleanup for a locked copy that could not be read', async () => {
    vi.mocked(service.wcInfo).mockRejectedValue({
      kind: 'working_copy_locked',
      message: 'copia bloqueada',
    });
    await mountOpenPanel('wc-bloqueada');
    const cleanup = button('Cleanup');
    expect(cleanup?.classes()).toContain('btn--primary');
    expect(wrapper.text()).toContain('Usa Cleanup para liberarla');
    vi.mocked(service.wcInfo).mockResolvedValue({} as service.InfoEntry);
    finishWith(okResult);
    await cleanup?.trigger('click');
    await flushPromises();
    expect(service.wcCleanup).toHaveBeenCalledWith({ path: 'wc-bloqueada' });
  });

  it('explains an old-format copy without offering Cleanup', async () => {
    vi.mocked(service.wcInfo).mockRejectedValue({
      kind: 'working_copy_too_old',
      message: 'formato antiguo',
    });
    await mountOpenPanel('wc-vieja');
    expect(wrapper.text()).toContain('svn upgrade');
    expect(button('Cleanup')).toBeUndefined();
  });

  it('counts a finished operation once it is fully done', async () => {
    finishWith(okResult);
    await mountOpenPanel();
    const store = useProjectStore();
    const before = store.finishedOperations;
    await button('Actualizar')?.trigger('click');
    await flushPromises();
    expect(store.finishedOperations).toBe(before + 1);
  });
});
