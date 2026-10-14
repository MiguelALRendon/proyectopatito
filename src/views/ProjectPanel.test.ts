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
  pickDirectory: vi.fn(),
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

async function mountOpenPanel() {
  const pinia = createPinia();
  wrapper = mount(ProjectPanel, {
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
      'Abrir',
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

describe('ProjectPanel opening a copy', () => {
  it('ignores an empty path and opens the typed one trimmed', async () => {
    await mountOpenPanel();
    vi.mocked(service.wcInfo).mockClear();
    const form = wrapper
      .findAll('form')
      .find((item) => item.find('#open-path').exists())!;
    await form.trigger('submit');
    expect(service.wcInfo).not.toHaveBeenCalled();
    await wrapper.find('#open-path').setValue('  otra  ');
    await form.trigger('submit');
    await flushPromises();
    expect(service.wcInfo).toHaveBeenCalledWith('otra');
  });

  it('disables the open button while a copy is still being read', async () => {
    await mountOpenPanel();
    vi.mocked(service.wcInfo).mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    void useProjectStore().open('otra');
    await flushPromises();
    expect(button('Abrir')?.attributes('disabled')).toBeDefined();
  });

  it('fills the path from the folder picker and shows its failure', async () => {
    vi.mocked(service.pickDirectory).mockResolvedValueOnce('C:\\elegida');
    await mountOpenPanel();
    await button('Elegir carpeta')?.trigger('click');
    await flushPromises();
    expect((wrapper.find('#open-path').element as HTMLInputElement).value).toBe(
      'C:\\elegida',
    );
    vi.mocked(service.pickDirectory).mockRejectedValueOnce({
      kind: 'io',
      message: 'selector roto',
    });
    await button('Elegir carpeta')?.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('selector roto');
  });
});
