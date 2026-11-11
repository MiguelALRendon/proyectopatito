import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

vi.mock('../../services/marketplaceApi', () => ({
  marketplaceCertList: vi.fn(),
  marketplaceCertRevoke: vi.fn(),
  marketplaceCertImport: vi.fn(),
}));
vi.mock('../../services/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/tauri')>()),
  pickFile: vi.fn(),
}));

import { resolveConfirm, useConfirm } from '../../composables/useConfirm';
import {
  marketplaceCertImport,
  marketplaceCertList,
  marketplaceCertRevoke,
  type TrustedCert,
} from '../../services/marketplaceApi';
import { pickFile } from '../../services/tauri';
import { formatDate } from '../../utils/svnLabels';
import CertificatesDialog from './CertificatesDialog.vue';

const PINNED_SHA = 'ab'.repeat(32);
const CA_SHA = 'cd'.repeat(32);

const PINNED: TrustedCert = {
  sha256: PINNED_SHA,
  subject: 'CN=intranet',
  issuer: 'CN=intranet',
  not_after: '2027-01-01T00:00:00Z',
  kind: 'pinned',
  scope: '127.0.0.1:8443',
  allowed: [],
  added_at: 1,
};

const AUTHORITY: TrustedCert = {
  ...PINNED,
  sha256: CA_SHA,
  subject: 'CN=Empresa CA',
  issuer: 'CN=Empresa CA',
  kind: 'authority',
  scope: null,
};

let wrapper: VueWrapper;

async function mountDialog(list: TrustedCert[] = [PINNED, AUTHORITY]) {
  vi.mocked(marketplaceCertList).mockResolvedValue(list);
  wrapper = mount(CertificatesDialog, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

const text = () => document.body.textContent ?? '';
const status = () => document.body.querySelector('.certs__status')!;
const rows = () => [...document.body.querySelectorAll('.certs__item')];
const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;

async function press(label: string) {
  button(label)!.click();
  await flushPromises();
}

function escape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  return flushPromises();
}

beforeEach(() => vi.resetAllMocks());

afterEach(() => {
  resolveConfirm(false);
  wrapper.unmount();
});

describe('CertificatesDialog list', () => {
  it('lists each certificate with kind, scope, subject, issuer, fingerprint and expiry', async () => {
    await mountDialog();
    const [pinned, authority] = rows();
    expect(pinned.textContent).toContain('Fijado');
    expect(pinned.textContent).toContain('127.0.0.1:8443');
    expect(pinned.textContent).toContain('CN=intranet');
    expect(pinned.textContent).toContain(formatDate('2027-01-01T00:00:00Z'));
    expect(authority.textContent).toContain('Autoridad');
    expect(authority.textContent).toContain('todos los servidores');
  });

  it('abbreviates the fingerprint and keeps the full one in the title', async () => {
    await mountDialog([PINNED]);
    const code = document.body.querySelector('.certs__fingerprint')!;
    expect(code.textContent).toBe('AB:AB:AB:AB:AB:AB:AB:AB');
    expect(code.getAttribute('title')).toBe(
      Array(32).fill('AB').join(':'),
    );
  });

  it('labels the list and each revoke button with the subject', async () => {
    await mountDialog();
    expect(
      document.body.querySelector('ul')?.getAttribute('aria-label'),
    ).toBe('Certificados de confianza');
    expect(
      document.body.querySelector('[aria-label="Revocar CN=intranet"]'),
    ).not.toBeNull();
  });

  it('explains the empty state', async () => {
    await mountDialog([]);
    expect(text()).toContain('Aún no confías en ningún certificado.');
    expect(document.body.querySelector('ul')).toBeNull();
    expect(button('Importar autoridad…')).toBeDefined();
  });

  it('shows the load error with a retry that loads again', async () => {
    vi.mocked(marketplaceCertList).mockRejectedValueOnce({
      kind: 'io',
      message: 'No se pudo leer la lista.',
    });
    wrapper = mount(CertificatesDialog, { attachTo: document.body });
    await flushPromises();
    expect(text()).toContain('No se pudo leer la lista.');
    expect(text()).not.toContain('Aún no confías');
    vi.mocked(marketplaceCertList).mockResolvedValue([PINNED]);
    await press('Reintentar');
    expect(rows()).toHaveLength(1);
    expect(text()).not.toContain('No se pudo leer la lista.');
  });

  it('announces loading in the persistent status region', async () => {
    vi.mocked(marketplaceCertList).mockReturnValue(new Promise(() => undefined));
    wrapper = mount(CertificatesDialog, { attachTo: document.body });
    await flushPromises();
    expect(status().getAttribute('role')).toBe('status');
    expect(status().textContent).toContain('Cargando certificados…');
  });
});

describe('CertificatesDialog revoke', () => {
  it('asks for confirmation and does nothing when it is declined', async () => {
    await mountDialog();
    button('Revocar')!.click();
    await flushPromises();
    expect(useConfirm().message.value).toBe(
      'Se dejará de confiar en este certificado.',
    );
    expect(useConfirm().confirmLabel.value).toBe('Revocar');
    resolveConfirm(false);
    await flushPromises();
    expect(marketplaceCertRevoke).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(2);
  });

  it('revokes after confirming, announces it and moves the focus to a stable control', async () => {
    await mountDialog();
    vi.mocked(marketplaceCertRevoke).mockResolvedValue(undefined);
    const region = status();
    button('Revocar')!.click();
    await flushPromises();
    resolveConfirm(true);
    await flushPromises();
    expect(marketplaceCertRevoke).toHaveBeenCalledWith(PINNED_SHA);
    expect(rows()).toHaveLength(1);
    expect(status()).toBe(region);
    expect(region.textContent).toContain('Se revocó la confianza en «CN=intranet».');
    expect(document.activeElement).toBe(button('Importar autoridad…'));
  });

  it('shows the backend message and keeps the row when revoking fails', async () => {
    await mountDialog();
    vi.mocked(marketplaceCertRevoke).mockRejectedValue({
      kind: 'io',
      message: 'No se pudo guardar la configuración.',
    });
    button('Revocar')!.click();
    await flushPromises();
    resolveConfirm(true);
    await flushPromises();
    expect(status().textContent).toContain('No se pudo guardar la configuración.');
    expect(rows()).toHaveLength(2);
  });
});

describe('CertificatesDialog import', () => {
  it('imports the picked authority and adds it to the list', async () => {
    await mountDialog([]);
    vi.mocked(pickFile).mockResolvedValue('C:/ca/empresa.pem');
    vi.mocked(marketplaceCertImport).mockResolvedValue(AUTHORITY);
    await press('Importar autoridad…');
    expect(pickFile).toHaveBeenCalledWith([
      { name: 'Certificados', extensions: ['crt', 'pem', 'cer', 'der'] },
    ]);
    expect(marketplaceCertImport).toHaveBeenCalledWith('C:/ca/empresa.pem');
    expect(rows()).toHaveLength(1);
    expect(status().textContent).toContain('Se importó «CN=Empresa CA».');
    expect(text()).not.toContain('Aún no confías');
  });

  it('does not duplicate a certificate that was already trusted', async () => {
    await mountDialog([AUTHORITY]);
    vi.mocked(pickFile).mockResolvedValue('C:/ca/empresa.pem');
    vi.mocked(marketplaceCertImport).mockResolvedValue(AUTHORITY);
    await press('Importar autoridad…');
    expect(rows()).toHaveLength(1);
  });

  it('does nothing when the picker is dismissed', async () => {
    await mountDialog();
    vi.mocked(pickFile).mockResolvedValue(null);
    await press('Importar autoridad…');
    expect(marketplaceCertImport).not.toHaveBeenCalled();
    expect(status().textContent?.trim()).toBe('');
  });

  it('shows the backend message when the import is rejected', async () => {
    await mountDialog();
    vi.mocked(pickFile).mockResolvedValue('C:/ca/mala.pem');
    vi.mocked(marketplaceCertImport).mockRejectedValue({
      kind: 'invalid_path',
      message: 'El archivo no es un certificado válido.',
    });
    await press('Importar autoridad…');
    expect(status().textContent).toContain(
      'El archivo no es un certificado válido.',
    );
    expect(rows()).toHaveLength(2);
  });

  it('shows a picker failure', async () => {
    await mountDialog();
    vi.mocked(pickFile).mockRejectedValue({
      kind: 'io',
      message: 'No se pudo abrir el selector.',
    });
    await press('Importar autoridad…');
    expect(status().textContent).toContain('No se pudo abrir el selector.');
    expect(marketplaceCertImport).not.toHaveBeenCalled();
  });
});

describe('CertificatesDialog closing', () => {
  it('closes with Cerrar and with Escape', async () => {
    const view = await mountDialog();
    await press('Cerrar');
    await escape();
    expect(view.emitted('close')).toHaveLength(2);
  });

  it('keeps itself open when Escape is meant for the confirmation', async () => {
    const view = await mountDialog();
    button('Revocar')!.click();
    await flushPromises();
    await escape();
    expect(view.emitted('close')).toBeUndefined();
  });

  it('starts with the focus on a harmless control inside the dialog', async () => {
    await mountDialog();
    expect(document.activeElement).toBe(button('Importar autoridad…'));
  });
});
