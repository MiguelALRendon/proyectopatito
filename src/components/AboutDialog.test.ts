import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import type { SvnDetection } from '../services/tauri';

vi.mock('../services/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/tauri')>()),
  appAbout: vi.fn(),
}));

import { appAbout } from '../services/tauri';
import { useWorkspaceStore } from '../stores/workspace';
import AboutDialog from './AboutDialog.vue';
import SvnVersionNotice from './SvnVersionNotice.vue';

const LICENSES = '# Licencias de terceros\nSlikSVN 1.14.5';

function detection(extra: Partial<SvnDetection> = {}): SvnDetection {
  return {
    binary: { path: 'C:\\svn.exe', version: '1.14.5', origin: 'bundled' },
    error: null,
    warning: null,
    ...extra,
  };
}

let wrapper: VueWrapper;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(appAbout).mockReset();
  vi.mocked(appAbout).mockResolvedValue({
    version: '0.1.0',
    licenses: LICENSES,
  });
});

afterEach(() => wrapper.unmount());

function mountDialog(svn: SvnDetection | null) {
  useWorkspaceStore().svn = svn;
  wrapper = mount(AboutDialog, { attachTo: document.body });
  return flushPromises();
}

const dialogText = () =>
  document.body.querySelector('[role="dialog"]')?.textContent ?? '';

describe('AboutDialog', () => {
  it('muestra la versión de la aplicación, la de svn con su origen y las licencias', async () => {
    await mountDialog(detection());
    expect(dialogText()).toContain('0.1.0');
    expect(dialogText()).toContain('1.14.5 (incluido con la aplicación)');
    expect(dialogText()).toContain('SlikSVN 1.14.5');
  });

  it('distingue el origen de un svn elegido por el usuario y del sistema', async () => {
    await mountDialog(
      detection({
        binary: { path: 'C:\\x.exe', version: '1.14.2', origin: 'configured' },
      }),
    );
    expect(dialogText()).toContain('elegido por ti');
    wrapper.unmount();
    await mountDialog(
      detection({
        binary: { path: 'C:\\x.exe', version: '1.14.2', origin: 'system' },
      }),
    );
    expect(dialogText()).toContain('instalado en el sistema');
  });

  it('repite el aviso persistente de una versión vulnerable', async () => {
    await mountDialog(detection({ warning: 'svn 1.14.2 es anterior (CVE)' }));
    expect(dialogText()).toContain('CVE');
  });

  it('sin svn lo dice, y si el comando falla muestra el error sin romperse', async () => {
    vi.mocked(appAbout).mockRejectedValue({
      kind: 'io',
      message: 'no se pudo',
      codes: [],
      detail: null,
    });
    await mountDialog(detection({ binary: null, error: 'no hay' }));
    expect(dialogText()).toContain('no detectado');
    expect(dialogText()).toContain('no se pudo');
    expect(document.body.querySelector('pre')).toBeNull();
  });

  it('las licencias se pintan como texto, nunca como HTML', async () => {
    vi.mocked(appAbout).mockResolvedValue({
      version: '0.1.0',
      licenses: '<img src=x onerror=alert(1)>',
    });
    await mountDialog(detection());
    expect(document.body.querySelector('pre img')).toBeNull();
    expect(document.body.querySelector('pre')?.textContent).toContain('<img');
  });

  it('Cerrar emite close', async () => {
    await mountDialog(detection());
    const button = [...document.body.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Cerrar'),
    ) as HTMLButtonElement;
    button.click();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});

describe('SvnVersionNotice', () => {
  function mountNotice(svn: SvnDetection | null) {
    useWorkspaceStore().svn = svn;
    wrapper = mount(SvnVersionNotice);
  }

  it('dice «Subversion incluido» cuando es el empaquetado', () => {
    mountNotice(detection());
    expect(wrapper.text()).toContain('Subversion incluido (versión 1.14.5).');
  });

  it('dice «detectado» cuando viene del sistema o de la configuración', () => {
    mountNotice(
      detection({
        binary: { path: 'C:\\x.exe', version: '1.14.2', origin: 'system' },
      }),
    );
    expect(wrapper.text()).toContain('Subversion 1.14.2 detectado.');
  });

  it('muestra el aviso persistente de la versión junto al estado', () => {
    mountNotice(detection({ warning: 'svn 1.14.2 es anterior (CVE)' }));
    expect(wrapper.text()).toContain('CVE');
  });

  it('sin svn muestra el error y no el aviso', () => {
    mountNotice({ binary: null, error: 'no hay svn', warning: null });
    expect(wrapper.text()).toContain('Subversion no detectado');
    expect(wrapper.text()).toContain('no hay svn');
  });
});
