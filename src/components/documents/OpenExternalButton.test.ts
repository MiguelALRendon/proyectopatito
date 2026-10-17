import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

vi.mock('../../services/filesApi', () => ({
  fsCanOpenExternal: vi.fn(),
  fsOpenExternal: vi.fn(),
}));

import { fsCanOpenExternal, fsOpenExternal } from '../../services/filesApi';
import type { CommandError } from '../../services/tauri';
import OpenExternalButton from './OpenExternalButton.vue';

const LABEL = 'Abrir con la aplicación predeterminada';

let wrapper: VueWrapper;

function failure(kind: CommandError['kind'], message: string): CommandError {
  return { kind, message, codes: [], detail: null };
}

async function mountButton(path = 'wc\\informe.docx') {
  wrapper = mount(OpenExternalButton, { props: { path } });
  await flushPromises();
  return wrapper;
}

const button = () => wrapper.find('button');

beforeEach(() => {
  vi.mocked(fsCanOpenExternal).mockReset().mockResolvedValue(false);
  vi.mocked(fsOpenExternal).mockReset().mockResolvedValue(undefined);
});

afterEach(() => wrapper.unmount());

describe('OpenExternalButton: adversarial', () => {
  it('no ofrece el botón si el backend no lo permite y nunca lanza nada', async () => {
    await mountButton('wc\\script.js');
    expect(button().exists()).toBe(false);
    expect(wrapper.text()).toBe('');
    expect(fsOpenExternal).not.toHaveBeenCalled();
  });

  it('pregunta al backend por la ruta exacta, sin decidir por la extensión', async () => {
    await mountButton('wc\\a.pdf.exe');
    expect(fsCanOpenExternal).toHaveBeenCalledExactlyOnceWith('wc\\a.pdf.exe');
    expect(button().exists()).toBe(false);
  });

  it('un backend que falla al consultar no deja el botón visible', async () => {
    vi.mocked(fsCanOpenExternal).mockRejectedValue(
      failure('outside_workspace', 'fuera'),
    );
    await mountButton();
    expect(button().exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('una respuesta que no es true no muestra el botón', async () => {
    vi.mocked(fsCanOpenExternal).mockResolvedValue(
      undefined as unknown as boolean,
    );
    await mountButton();
    expect(button().exists()).toBe(false);
  });

  it('al cambiar a un archivo no permitido el botón desaparece', async () => {
    vi.mocked(fsCanOpenExternal).mockResolvedValueOnce(true);
    await mountButton('wc\\a.docx');
    expect(button().exists()).toBe(true);
    await wrapper.setProps({ path: 'wc\\b.exe' });
    await flushPromises();
    expect(button().exists()).toBe(false);
    expect(fsCanOpenExternal).toHaveBeenLastCalledWith('wc\\b.exe');
  });

  it('una respuesta tardía de un archivo anterior no habilita el botón del actual', async () => {
    let resolveFirst: (allowed: boolean) => void = () => undefined;
    vi.mocked(fsCanOpenExternal)
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(false);
    await mountButton('wc\\a.docx');
    await wrapper.setProps({ path: 'wc\\b.exe' });
    await flushPromises();
    resolveFirst(true);
    await flushPromises();
    expect(button().exists()).toBe(false);
  });

  it('NotAllowed muestra el mensaje del backend y deja reintentar', async () => {
    vi.mocked(fsCanOpenExternal).mockResolvedValue(true);
    vi.mocked(fsOpenExternal).mockRejectedValue(
      failure('not_allowed', 'este archivo no se abre'),
    );
    await mountButton();
    await button().trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'No se pudo abrir con la aplicación predeterminada: este archivo no se abre',
    );
    expect(button().attributes('disabled')).toBeUndefined();
    vi.mocked(fsOpenExternal).mockResolvedValue(undefined);
    await button().trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('cualquier otro error también se muestra en español sin romper el botón', async () => {
    vi.mocked(fsCanOpenExternal).mockResolvedValue(true);
    vi.mocked(fsOpenExternal).mockRejectedValue(
      failure('io', 'sin aplicación'),
    );
    await mountButton();
    await button().trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('sin aplicación');
    expect(button().exists()).toBe(true);
  });

  it('mientras se abre queda deshabilitado y un segundo clic no lanza otra vez', async () => {
    vi.mocked(fsCanOpenExternal).mockResolvedValue(true);
    let finish: () => void = () => undefined;
    vi.mocked(fsOpenExternal).mockReturnValue(
      new Promise<void>((resolve) => (finish = resolve)),
    );
    await mountButton();
    await button().trigger('click');
    await button().trigger('click');
    expect(button().attributes('disabled')).toBeDefined();
    expect(button().attributes('aria-busy')).toBe('true');
    expect(fsOpenExternal).toHaveBeenCalledTimes(1);
    finish();
    await flushPromises();
    expect(button().attributes('disabled')).toBeUndefined();
  });
});

describe('OpenExternalButton: contenido', () => {
  it('con un formato permitido ofrece el botón y lo lanza con la ruta', async () => {
    vi.mocked(fsCanOpenExternal).mockResolvedValue(true);
    await mountButton('wc\\informe.docx');
    expect(button().text()).toBe(LABEL);
    await button().trigger('click');
    expect(fsOpenExternal).toHaveBeenCalledExactlyOnceWith('wc\\informe.docx');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
