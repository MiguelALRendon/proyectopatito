import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('../../services/marketplaceApi', () => ({
  marketplaceReposGet: vi.fn(),
  marketplaceRepoSave: vi.fn(),
  marketplaceRepoRemove: vi.fn(),
  marketplaceRepoFavorite: vi.fn(),
  marketplaceRepoTest: vi.fn(),
  marketplaceRepoSetLastPath: vi.fn(),
  marketplaceCertInspect: vi.fn(),
  marketplaceCertTrust: vi.fn(),
  marketplaceCertImport: vi.fn(),
  marketplaceCertList: vi.fn(),
  marketplaceCertRevoke: vi.fn(),
}));
vi.mock('../../services/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/tauri')>()),
  pickFile: vi.fn(),
}));

import {
  marketplaceCertImport,
  marketplaceCertInspect,
  marketplaceCertTrust,
  marketplaceRepoSave,
  marketplaceRepoTest,
  type CertPrompt,
  type RepoEntry,
  type RepoTestResult,
} from '../../services/marketplaceApi';
import { pickFile } from '../../services/tauri';
import { useMarketplaceStore } from '../../stores/marketplace';
import RepoForm from './RepoForm.vue';

const SHA = 'ab'.repeat(32);
const PASSPHRASE = 'frase-ultra-secreta';
const CERT_PATH = 'C:/Certificados/cliente.p12';
const URL_TEXT = 'https://svn.example.com/docs';
const UNTRUSTED = {
  kind: 'untrusted_certificate',
  message: 'El certificado del servidor no es de confianza.',
};

const PROMPT: CertPrompt = {
  info: {
    host: 'svn.example.com',
    port: 443,
    sha256: SHA,
    subject: 'CN=svn.example.com',
    issuer: 'CN=svn.example.com',
    not_before: '2026-01-01T00:00:00Z',
    not_after: '2027-01-01T00:00:00Z',
  },
  reasons: ['unknown-ca'],
};

const RESULT: RepoTestResult = {
  uuid: '1234abcd-0000-4000-8000-0123456789ab',
  root: 'https://svn.example.com',
  url: URL_TEXT,
  revision: 12,
};

const SAVED: RepoEntry = {
  id: 4,
  name: 'Docs',
  url: URL_TEXT,
  username: null,
  favorite: false,
  last_path: '',
  uuid: null,
  root: null,
  client_cert: null,
};

let wrapper: VueWrapper;

function mountForm(repo: RepoEntry | null = null) {
  setActivePinia(createPinia());
  wrapper = mount(RepoForm, { props: { repo }, attachTo: document.body });
  return wrapper;
}

const input = (id: string) =>
  document.body.querySelector<HTMLInputElement>(`#${id}`)!;
const bodyText = () => document.body.textContent ?? '';
const trustDialog = () => document.body.querySelector('#cert-trust-title');
const credentialsDialog = () =>
  document.body.querySelector('#credentials-title');
const testCalls = () => vi.mocked(marketplaceRepoTest).mock.calls;

async function fill(id: string, value: string) {
  const element = input(id);
  element.value = value;
  element.dispatchEvent(new Event('input'));
  await flushPromises();
}

function button(label: string) {
  return [...document.body.querySelectorAll('button')]
    .filter((candidate) => candidate.textContent?.trim() === label)
    .pop();
}

async function press(label: string) {
  button(label)!.click();
  await flushPromises();
}

async function chooseCertificate(path = CERT_PATH) {
  vi.mocked(pickFile).mockResolvedValueOnce(path);
  await press('Elegir archivo…');
}

async function untrustedScenario() {
  mountForm();
  vi.mocked(marketplaceRepoTest).mockRejectedValueOnce(UNTRUSTED);
  vi.mocked(marketplaceCertInspect).mockResolvedValue(PROMPT);
  await fill('repo-form-url', URL_TEXT);
  await press('Probar conexión');
}

function escape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  return flushPromises();
}

beforeEach(() => vi.resetAllMocks());

afterEach(() => {
  wrapper.unmount();
});

describe('RepoForm untrusted certificate flow', () => {
  it('inspects the certificate and opens the dialog focused on Cancelar', async () => {
    await untrustedScenario();
    expect(marketplaceCertInspect).toHaveBeenCalledWith(URL_TEXT, null);
    expect(trustDialog()?.textContent).toBe('Certificado no confiable');
    expect(document.activeElement).toBe(button('Cancelar'));
    expect(testCalls()).toHaveLength(1);
  });

  it('passes the saved repository id to the inspection', async () => {
    mountForm(SAVED);
    vi.mocked(marketplaceRepoTest).mockRejectedValueOnce(UNTRUSTED);
    vi.mocked(marketplaceCertInspect).mockResolvedValue(PROMPT);
    await press('Probar conexión');
    expect(marketplaceCertInspect).toHaveBeenCalledWith(URL_TEXT, 4);
  });

  it('keeps the test button busy while the certificate is inspected', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValueOnce(UNTRUSTED);
    let release: (value: CertPrompt) => void = () => undefined;
    vi.mocked(marketplaceCertInspect).mockReturnValue(
      new Promise<CertPrompt>((resolve) => (release = resolve)),
    );
    await press('Probar conexión');
    expect(button('Probando…')!.disabled).toBe(true);
    expect(trustDialog()).toBeNull();
    release(PROMPT);
    await flushPromises();
    expect(trustDialog()).not.toBeNull();
    expect(button('Probar conexión')!.disabled).toBe(false);
  });

  it('trusts the seen fingerprint with the shown reasons and retries once', async () => {
    await untrustedScenario();
    vi.mocked(marketplaceCertTrust).mockResolvedValue({} as never);
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    await press('Confiar en este certificado');
    expect(marketplaceCertTrust).toHaveBeenCalledWith({
      url: URL_TEXT,
      sha256: SHA,
      allowed: ['unknown-ca'],
    });
    expect(testCalls()).toHaveLength(2);
    expect(trustDialog()).toBeNull();
    expect(bodyText()).toContain('Conexión correcta');
  });

  it('Cancelar closes the dialog, keeps the error visible and does not retry', async () => {
    await untrustedScenario();
    await press('Cancelar');
    expect(trustDialog()).toBeNull();
    expect(marketplaceCertTrust).not.toHaveBeenCalled();
    expect(testCalls()).toHaveLength(1);
    expect(bodyText()).toContain(UNTRUSTED.message);
    expect(document.body.querySelector('#repo-form-title')).not.toBeNull();
  });

  it('asks again on the next test after cancelling', async () => {
    await untrustedScenario();
    await press('Cancelar');
    vi.mocked(marketplaceRepoTest).mockRejectedValueOnce(UNTRUSTED);
    await press('Probar conexión');
    expect(marketplaceCertInspect).toHaveBeenCalledTimes(2);
    expect(trustDialog()).not.toBeNull();
  });

  it('Escape closes only the certificate dialog and never trusts', async () => {
    await untrustedScenario();
    const form = wrapper;
    await escape();
    expect(trustDialog()).toBeNull();
    expect(form.emitted('close')).toBeUndefined();
    expect(marketplaceCertTrust).not.toHaveBeenCalled();
  });

  it('shows a trust failure such as a changed fingerprint and does not retry', async () => {
    await untrustedScenario();
    vi.mocked(marketplaceCertTrust).mockRejectedValue({
      kind: 'conflict',
      message: 'El certificado cambió mientras lo revisabas.',
    });
    await press('Confiar en este certificado');
    expect(trustDialog()).toBeNull();
    expect(testCalls()).toHaveLength(1);
    expect(bodyText()).toContain('El certificado cambió mientras lo revisabas.');
    expect(bodyText()).not.toContain('Conexión correcta');
  });

  it('shows an inspection failure without opening the dialog', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValueOnce(UNTRUSTED);
    vi.mocked(marketplaceCertInspect).mockRejectedValue({
      kind: 'network',
      message: 'No se pudo leer el certificado.',
    });
    await press('Probar conexión');
    expect(trustDialog()).toBeNull();
    expect(bodyText()).toContain('No se pudo leer el certificado.');
    expect(marketplaceCertTrust).not.toHaveBeenCalled();
  });

  it('does not loop when the retry is untrusted again', async () => {
    await untrustedScenario();
    vi.mocked(marketplaceCertTrust).mockResolvedValue({} as never);
    vi.mocked(marketplaceRepoTest).mockRejectedValue(UNTRUSTED);
    await press('Confiar en este certificado');
    expect(testCalls()).toHaveLength(2);
    expect(marketplaceCertInspect).toHaveBeenCalledTimes(1);
    expect(trustDialog()).toBeNull();
    expect(bodyText()).toContain(UNTRUSTED.message);
    expect(button('Probar conexión')!.disabled).toBe(false);
  });

  it('keeps Confiar and Importar disabled while working, Cancelar enabled', async () => {
    await untrustedScenario();
    let release: (value: never) => void = () => undefined;
    vi.mocked(marketplaceCertTrust).mockReturnValue(
      new Promise<never>((resolve) => (release = resolve)),
    );
    await press('Confiar en este certificado');
    expect(button('Confiar en este certificado')!.disabled).toBe(true);
    expect(button('Cancelar')!.disabled).toBe(false);
    expect(
      document.body.querySelector('.cert-trust__status')?.textContent,
    ).toBe('Procesando…');
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    release({} as never);
    await flushPromises();
    expect(bodyText()).toContain('Conexión correcta');
  });

  it('does not retry when the dialog is cancelled while trusting', async () => {
    await untrustedScenario();
    let release: (value: never) => void = () => undefined;
    vi.mocked(marketplaceCertTrust).mockReturnValue(
      new Promise<never>((resolve) => (release = resolve)),
    );
    await press('Confiar en este certificado');
    await press('Cancelar');
    release({} as never);
    await flushPromises();
    expect(testCalls()).toHaveLength(1);
  });

  it('ignores a slow inspection when the form is closed', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValueOnce(UNTRUSTED);
    let release: (value: CertPrompt) => void = () => undefined;
    vi.mocked(marketplaceCertInspect).mockReturnValue(
      new Promise<CertPrompt>((resolve) => (release = resolve)),
    );
    await press('Probar conexión');
    wrapper.unmount();
    release(PROMPT);
    await flushPromises();
    expect(trustDialog()).toBeNull();
    mountForm();
  });
});

describe('RepoForm authority import from the dialog', () => {
  const ISSUED: CertPrompt = {
    ...PROMPT,
    info: { ...PROMPT.info, issuer: 'CN=Autoridad de la empresa' },
  };

  async function issuedScenario() {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValueOnce(UNTRUSTED);
    vi.mocked(marketplaceCertInspect).mockResolvedValue(ISSUED);
    await press('Probar conexión');
  }

  it('imports the picked authority and retries the test', async () => {
    await issuedScenario();
    vi.mocked(pickFile).mockResolvedValue('C:/ca/empresa.pem');
    vi.mocked(marketplaceCertImport).mockResolvedValue({} as never);
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    await press('Importar autoridad…');
    expect(pickFile).toHaveBeenCalledWith([
      { name: 'Certificados', extensions: ['crt', 'pem', 'cer', 'der'] },
    ]);
    expect(marketplaceCertImport).toHaveBeenCalledWith('C:/ca/empresa.pem');
    expect(testCalls()).toHaveLength(2);
    expect(trustDialog()).toBeNull();
    expect(bodyText()).toContain('Conexión correcta');
  });

  it('keeps the dialog open when the file picker is dismissed', async () => {
    await issuedScenario();
    vi.mocked(pickFile).mockResolvedValue(null);
    await press('Importar autoridad…');
    expect(marketplaceCertImport).not.toHaveBeenCalled();
    expect(trustDialog()).not.toBeNull();
    expect(testCalls()).toHaveLength(1);
  });

  it('shows an import failure and does not retry', async () => {
    await issuedScenario();
    vi.mocked(pickFile).mockResolvedValue('C:/ca/mala.pem');
    vi.mocked(marketplaceCertImport).mockRejectedValue({
      kind: 'invalid_path',
      message: 'El archivo no es un certificado válido.',
    });
    await press('Importar autoridad…');
    expect(trustDialog()).toBeNull();
    expect(bodyText()).toContain('El archivo no es un certificado válido.');
    expect(testCalls()).toHaveLength(1);
  });
});

describe('RepoForm client certificate', () => {
  it('offers the section without a passphrase field until a file is chosen', async () => {
    mountForm();
    expect(bodyText()).toContain('Certificado de cliente (opcional)');
    expect(input('repo-form-cert').readOnly).toBe(true);
    expect(input('repo-form-passphrase')).toBeNull();
    expect(button('Quitar')).toBeUndefined();
    await chooseCertificate();
    expect(pickFile).toHaveBeenCalledWith([
      { name: 'PKCS#12', extensions: ['p12', 'pfx'] },
    ]);
    expect(input('repo-form-cert').value).toBe(CERT_PATH);
    const field = input('repo-form-passphrase');
    expect(field.type).toBe('password');
    expect(field.autocomplete).toBe('off');
  });

  it('removes the certificate and its passphrase field', async () => {
    mountForm();
    await chooseCertificate();
    await press('Quitar');
    expect(input('repo-form-cert').value).toBe('');
    expect(input('repo-form-passphrase')).toBeNull();
  });

  it('keeps the previous file when the picker is dismissed', async () => {
    mountForm();
    await chooseCertificate();
    vi.mocked(pickFile).mockResolvedValueOnce(null);
    await press('Elegir archivo…');
    expect(input('repo-form-cert').value).toBe(CERT_PATH);
  });

  it('shows a picker failure under the field', async () => {
    mountForm();
    vi.mocked(pickFile).mockRejectedValue({
      kind: 'io',
      message: 'No se pudo abrir el selector.',
    });
    await press('Elegir archivo…');
    expect(
      input('repo-form-cert-error').textContent?.trim(),
    ).toBe('No se pudo abrir el selector.');
  });

  it('blocks the test without a passphrase and focuses the field', async () => {
    mountForm();
    await chooseCertificate();
    await press('Probar conexión');
    expect(marketplaceRepoTest).not.toHaveBeenCalled();
    expect(
      input('repo-form-passphrase-error').textContent?.trim(),
    ).toBe('Indica la frase de paso del certificado.');
    expect(input('repo-form-passphrase').getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(input('repo-form-passphrase'));
  });

  it('clears the passphrase error as soon as the user types', async () => {
    mountForm();
    await chooseCertificate();
    await press('Probar conexión');
    await fill('repo-form-passphrase', 'x');
    expect(input('repo-form-passphrase').getAttribute('aria-invalid')).toBe(
      'false',
    );
    expect(input('repo-form-passphrase-error').textContent?.trim()).toBe('');
  });

  it('sends path and passphrase only in the test call, then wipes the field', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    await chooseCertificate();
    await fill('repo-form-passphrase', PASSPHRASE);
    await press('Probar conexión');
    expect(testCalls()[0][0]).toMatchObject({
      client_cert: CERT_PATH,
      client_cert_passphrase: PASSPHRASE,
    });
    expect(input('repo-form-passphrase').value).toBe('');
    expect(JSON.stringify(useMarketplaceStore().$state)).not.toContain(
      PASSPHRASE,
    );
    expect(document.body.innerHTML).not.toContain(PASSPHRASE);
  });

  it('saves the certificate path and never the passphrase', async () => {
    mountForm();
    vi.mocked(marketplaceRepoSave).mockResolvedValue(SAVED);
    await chooseCertificate();
    await fill('repo-form-passphrase', PASSPHRASE);
    await press('Guardar');
    const draft = vi.mocked(marketplaceRepoSave).mock.calls[0][0];
    expect(draft.client_cert).toBe(CERT_PATH);
    expect(JSON.stringify(draft)).not.toContain(PASSPHRASE);
  });

  it('saves a null certificate after removing the stored one', async () => {
    mountForm({ ...SAVED, client_cert: CERT_PATH });
    vi.mocked(marketplaceRepoSave).mockResolvedValue(SAVED);
    await press('Quitar');
    await press('Guardar');
    expect(vi.mocked(marketplaceRepoSave).mock.calls[0][0].client_cert).toBeNull();
  });

  it('shows client_certificate without opening the credentials dialog', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValue({
      kind: 'client_certificate',
      message:
        'El servidor exige un certificado de cliente o la frase de paso es incorrecta.',
    });
    await chooseCertificate();
    await fill('repo-form-passphrase', PASSPHRASE);
    await press('Probar conexión');
    expect(credentialsDialog()).toBeNull();
    expect(trustDialog()).toBeNull();
    expect(bodyText()).toContain('la frase de paso es incorrecta');
    expect(input('repo-form-passphrase').value).toBe('');
  });

  it('keeps the passphrase for the automatic retry after trusting, then wipes it', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValueOnce(UNTRUSTED);
    vi.mocked(marketplaceCertInspect).mockResolvedValue(PROMPT);
    await chooseCertificate();
    await fill('repo-form-passphrase', PASSPHRASE);
    await press('Probar conexión');
    expect(input('repo-form-passphrase').value).toBe(PASSPHRASE);
    vi.mocked(marketplaceCertTrust).mockResolvedValue({} as never);
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    await press('Confiar en este certificado');
    expect(testCalls()[1][0].client_cert_passphrase).toBe(PASSPHRASE);
    expect(input('repo-form-passphrase').value).toBe('');
  });

  it('wipes the passphrase when the certificate dialog is cancelled', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValueOnce(UNTRUSTED);
    vi.mocked(marketplaceCertInspect).mockResolvedValue(PROMPT);
    await chooseCertificate();
    await fill('repo-form-passphrase', PASSPHRASE);
    await press('Probar conexión');
    await press('Cancelar');
    expect(input('repo-form-passphrase').value).toBe('');
  });

  it('wipes the passphrase when the credentials dialog is cancelled', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValue({
      kind: 'auth_required',
      message: 'Pide acceso.',
    });
    await chooseCertificate();
    await fill('repo-form-passphrase', PASSPHRASE);
    await press('Probar conexión');
    expect(input('repo-form-passphrase').value).toBe(PASSPHRASE);
    await escape();
    expect(input('repo-form-passphrase').value).toBe('');
  });

  it('drops the result when the certificate changes', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    await chooseCertificate();
    await fill('repo-form-passphrase', PASSPHRASE);
    await press('Probar conexión');
    expect(bodyText()).toContain('Conexión correcta');
    await chooseCertificate('C:/Certificados/otro.pfx');
    expect(bodyText()).not.toContain('Conexión correcta');
  });

  it('drops the response of a slow test when the form is closed', async () => {
    const form = mountForm();
    let release: (value: RepoTestResult) => void = () => undefined;
    vi.mocked(marketplaceRepoTest).mockReturnValue(
      new Promise<RepoTestResult>((resolve) => (release = resolve)),
    );
    await press('Probar conexión');
    expect(button('Probando…')).toBeDefined();
    form.unmount();
    release(RESULT);
    await flushPromises();
    expect(bodyText()).not.toContain('Conexión correcta');
    mountForm();
  });
});
