import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';

vi.mock('../services/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/tauri')>()),
  workspaceSet: vi.fn(),
  svnSetPath: vi.fn(),
  svnDetect: vi.fn(),
  pickDirectory: vi.fn(),
}));

import * as service from '../services/tauri';
import OnboardingView from './OnboardingView.vue';

let wrapper: VueWrapper;

function button(label: string) {
  return wrapper.findAll('button').find((item) => item.text() === label);
}

beforeEach(() => {
  vi.resetAllMocks();
  wrapper = mount(OnboardingView, { global: { plugins: [createPinia()] } });
});

afterEach(() => wrapper.unmount());

describe('OnboardingView workspace root', () => {
  it('asks for the root and saves nothing when the field is empty', async () => {
    await wrapper.find('form').trigger('submit');
    expect(wrapper.find('#workspace-root-error').text()).toBe(
      'Indica la carpeta raíz del workspace.',
    );
    expect(service.workspaceSet).not.toHaveBeenCalled();
  });

  it('saves the trimmed root and confirms it', async () => {
    vi.mocked(service.workspaceSet).mockResolvedValue('C:\\raiz');
    await wrapper.find('#workspace-root').setValue('  C:\\raiz  ');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(service.workspaceSet).toHaveBeenCalledWith('C:\\raiz');
    expect(wrapper.text()).toContain('Carpeta raíz guardada.');
  });

  it('shows the backend error when the root is rejected', async () => {
    vi.mocked(service.workspaceSet).mockRejectedValue({
      kind: 'invalid_path',
      message: 'La ruta no existe',
    });
    await wrapper.find('#workspace-root').setValue('C:\\nada');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('La ruta no existe');
    expect(wrapper.text()).not.toContain('Carpeta raíz guardada.');
  });
});

describe('OnboardingView svn detection', () => {
  it('re-detects svn on demand and reports it', async () => {
    vi.mocked(service.svnDetect).mockResolvedValue({
      binary: { path: 'C:\\svn.exe', version: '1.14.2', origin: 'system' },
      error: null,
      warning: null,
    });
    await button('Detectar de nuevo')?.trigger('click');
    await flushPromises();
    expect(service.svnDetect).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Detección completada.');
  });
});

describe('OnboardingView with the bundled svn', () => {
  it('muestra Subversion incluido y deja el campo de otra ruta plegado', async () => {
    vi.mocked(service.svnDetect).mockResolvedValue({
      binary: { path: 'C:\app\svn.exe', version: '1.14.5', origin: 'bundled' },
      error: null,
      warning: null,
    });
    await button('Detectar de nuevo')?.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Subversion incluido (versión 1.14.5).');
    const details = wrapper.find('details.onboarding__path');
    expect(details.exists()).toBe(true);
    expect(details.attributes('open')).toBeUndefined();
    expect(details.find('#svn-path').exists()).toBe(true);
  });
});

describe('OnboardingView with a svn that is not the bundled one', () => {
  it.each(['system', 'configured'] as const)(
    'con un svn %s el campo de la ruta está siempre visible, sin plegar',
    async (origin) => {
      vi.mocked(service.svnDetect).mockResolvedValue({
        binary: { path: 'C:/x/svn.exe', version: '1.14.2', origin },
        error: null,
        warning: null,
      });
      await button('Detectar de nuevo')?.trigger('click');
      await flushPromises();
      expect(wrapper.find('details').exists()).toBe(false);
      expect(wrapper.find('div.onboarding__path #svn-path').exists()).toBe(
        true,
      );
    },
  );
});

describe('OnboardingView manual svn path', () => {
  it('ignores an empty path and saves the typed one trimmed', async () => {
    vi.mocked(service.svnSetPath).mockResolvedValue({
      binary: {
        path: 'C:\\svn\\svn.exe',
        version: '1.14.2',
        origin: 'configured',
      },
      error: null,
      warning: null,
    });
    const form = wrapper.findAll('form')[1];
    await form.trigger('submit');
    expect(service.svnSetPath).not.toHaveBeenCalled();
    await wrapper.find('#svn-path').setValue('  C:\\svn\\svn.exe  ');
    await form.trigger('submit');
    await flushPromises();
    expect(service.svnSetPath).toHaveBeenCalledWith('C:\\svn\\svn.exe');
    expect(wrapper.text()).toContain('Ruta de svn.exe guardada.');
  });
});

describe('OnboardingView failed svn detection', () => {
  const found = {
    path: 'C:\\svn\\svn.exe',
    version: '1.14.2',
    origin: 'configured' as const,
  };

  async function saveManualPath() {
    await wrapper.find('#svn-path').setValue('C:\\svn\\svn.exe');
    await wrapper.findAll('form')[1].trigger('submit');
    await flushPromises();
  }

  it('does not report success when the backend refuses the client and shows why', async () => {
    vi.mocked(service.svnSetPath).mockResolvedValue({
      binary: null,
      error: 'svn 1.9.7 es anterior a la mínima requerida',
      warning: null,
    });
    await saveManualPath();
    expect(wrapper.text()).not.toContain('Ruta de svn.exe guardada.');
    expect(wrapper.text()).toContain('anterior a la mínima requerida');
  });

  it('does not report success when the client works but could not be saved, and warns', async () => {
    vi.mocked(service.svnSetPath).mockResolvedValue({
      binary: found,
      error: 'no se pudo guardar la configuración',
      warning: null,
    });
    await saveManualPath();
    expect(wrapper.text()).not.toContain('Ruta de svn.exe guardada.');
    expect(wrapper.text()).toContain('Subversion 1.14.2 detectado.');
    expect(wrapper.text()).toContain('no se pudo guardar la configuración');
  });

  it('does not report a completed detection when nothing was found', async () => {
    vi.mocked(service.svnDetect).mockResolvedValue({
      binary: null,
      error: 'No se encontró svn.exe',
      warning: null,
    });
    await wrapper
      .findAll('button')
      .find((item) => item.text() === 'Detectar de nuevo')
      ?.trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('Detección completada.');
  });

  it('shows the error when saving the svn path is rejected', async () => {
    vi.mocked(service.svnSetPath).mockRejectedValue({
      kind: 'no_svn',
      message: 'No se encontró Subversion.',
    });
    await saveManualPath();
    expect(wrapper.text()).toContain('No se encontró Subversion.');
    expect(wrapper.text()).not.toContain('Ruta de svn.exe guardada.');
  });
});
