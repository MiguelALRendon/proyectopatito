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
}));

import {
  marketplaceRepoSave,
  marketplaceRepoTest,
  type RepoEntry,
  type RepoTestResult,
} from '../../services/marketplaceApi';
import { useMarketplaceStore } from '../../stores/marketplace';
import RepoForm from './RepoForm.vue';

const SECRET = 'clave-ultra-secreta';
const CACHE_NOTICE =
  'Subversion recordará esta credencial en su caché (la comparten otros clientes como TortoiseSVN). Marca «No recordar la contraseña» para evitarlo.';
const HTTP_NOTICE =
  'Esta conexión no está cifrada: la contraseña viajaría en claro.';
const UUID = '1234abcd-0000-4000-8000-0123456789ab';

const SAVED: RepoEntry = {
  id: 4,
  name: 'Docs',
  url: 'https://svn.example.com/docs',
  username: 'ana',
  favorite: false,
  last_path: '',
  uuid: null,
  root: null,
  client_cert: null,
};

const RESULT: RepoTestResult = {
  uuid: UUID,
  root: 'https://svn.example.com',
  url: SAVED.url,
  revision: 12,
};

let wrapper: VueWrapper;

function mountForm(repo: RepoEntry | null = null) {
  setActivePinia(createPinia());
  wrapper = mount(RepoForm, { props: { repo }, attachTo: document.body });
  return wrapper;
}

const input = (id: string) =>
  document.body.querySelector<HTMLInputElement>(`#${id}`)!;

async function fill(id: string, value: string) {
  const element = input(id);
  element.value = value;
  element.dispatchEvent(new Event('input'));
  await flushPromises();
}

function button(label: string) {
  return [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

async function press(label: string) {
  button(label)!.click();
  await flushPromises();
}

const credentialsDialog = () =>
  document.body.querySelector('#credentials-title');
const bodyText = () => document.body.textContent ?? '';
const lastTestArgs = () => vi.mocked(marketplaceRepoTest).mock.lastCall![0];

async function submitCredentials(user: string, password: string) {
  const username = document.body.querySelector<HTMLInputElement>(
    '#credentials-username',
  )!;
  const secret = document.body.querySelector<HTMLInputElement>(
    '#credentials-password',
  )!;
  username.value = user;
  username.dispatchEvent(new Event('input'));
  secret.value = password;
  secret.dispatchEvent(new Event('input'));
  await press('Reintentar');
}

beforeEach(() => vi.resetAllMocks());

afterEach(() => {
  wrapper.unmount();
});

describe('RepoForm fixed texts and notices', () => {
  it('shows the fields, the opt-out checkbox and the fixed cache notice', () => {
    mountForm();
    expect(document.body.querySelector('#repo-form-title')?.textContent).toBe(
      'Agregar repositorio',
    );
    ['Nombre', 'URL', 'Usuario (opcional)'].forEach((label) =>
      expect(bodyText()).toContain(label),
    );
    expect(bodyText()).toContain('No recordar la contraseña');
    expect(bodyText()).toContain(CACHE_NOTICE);
    expect(
      document.body
        .querySelector('input[type="checkbox"]')
        ?.getAttribute('aria-describedby'),
    ).toBe('repo-form-cache-notice');
  });

  it('warns reactively while the URL starts with http://', async () => {
    mountForm();
    expect(bodyText()).not.toContain(HTTP_NOTICE);
    await fill('repo-form-url', 'http://servidor/repo');
    expect(bodyText()).toContain(HTTP_NOTICE);
    await fill('repo-form-url', 'https://servidor/repo');
    expect(bodyText()).not.toContain(HTTP_NOTICE);
  });

  it('does not warn for svn:// or file:///', async () => {
    mountForm();
    await fill('repo-form-url', 'svn://servidor/repo');
    expect(bodyText()).not.toContain(HTTP_NOTICE);
    await fill('repo-form-url', 'file:///C:/repos/uno');
    expect(bodyText()).not.toContain(HTTP_NOTICE);
  });

  it('preloads the saved values when editing', () => {
    mountForm(SAVED);
    expect(document.body.querySelector('#repo-form-title')?.textContent).toBe(
      'Editar repositorio',
    );
    expect(input('repo-form-name').value).toBe('Docs');
    expect(input('repo-form-url').value).toBe(SAVED.url);
    expect(input('repo-form-username').value).toBe('ana');
  });
});

describe('RepoForm save and validation', () => {
  it('saves a new repository with no id and an empty user as null', async () => {
    const form = mountForm();
    vi.mocked(marketplaceRepoSave).mockResolvedValue(SAVED);
    await fill('repo-form-name', 'Docs');
    await fill('repo-form-url', 'svn://host/docs');
    await press('Guardar');
    expect(marketplaceRepoSave).toHaveBeenCalledWith({
      id: null,
      name: 'Docs',
      url: 'svn://host/docs',
      username: null,
      client_cert: null,
    });
    expect(form.emitted('saved')).toEqual([[4]]);
  });

  it('keeps the stored client certificate when an edit is saved', async () => {
    const cert = 'C:/Certificados/cliente.p12';
    mountForm({ ...SAVED, client_cert: cert });
    vi.mocked(marketplaceRepoSave).mockResolvedValue(SAVED);
    await press('Guardar');
    const sent = vi.mocked(marketplaceRepoSave).mock.calls[0][0];
    expect(sent.client_cert).toBe(cert);
  });

  it('saves an edit with the repository id, including id 0', async () => {
    const form = mountForm({ ...SAVED, id: 0 });
    vi.mocked(marketplaceRepoSave).mockResolvedValue({ ...SAVED, id: 0 });
    await press('Guardar');
    expect(vi.mocked(marketplaceRepoSave).mock.calls[0][0].id).toBe(0);
    expect(form.emitted('saved')).toEqual([[0]]);
  });

  it.each([
    ['El nombre no puede estar vacío.', 'repo-form-name-error'],
    ['La URL no es válida: usa http.', 'repo-form-url-error'],
    ['Ya existe un repositorio con esa URL.', 'repo-form-url-error'],
    ['Ya existe un repositorio con ese nombre.', 'repo-form-name-error'],
    ['El nombre de usuario no es válido.', 'repo-form-username-error'],
  ])('shows the backend message «%s» under its field', async (message, id) => {
    const form = mountForm();
    vi.mocked(marketplaceRepoSave).mockRejectedValue({
      kind: 'invalid_path',
      message,
    });
    await press('Guardar');
    expect(document.body.querySelector(`#${id}`)?.textContent?.trim()).toBe(
      message,
    );
    expect(form.emitted('saved')).toBeUndefined();
  });

  it('marks the offending field as invalid and clears it on the next attempt', async () => {
    mountForm();
    vi.mocked(marketplaceRepoSave).mockRejectedValueOnce({
      kind: 'invalid_path',
      message: 'La URL no es válida.',
    });
    await press('Guardar');
    expect(input('repo-form-url').getAttribute('aria-invalid')).toBe('true');
    vi.mocked(marketplaceRepoSave).mockResolvedValue(SAVED);
    await press('Guardar');
    expect(input('repo-form-url').getAttribute('aria-invalid')).toBe('false');
  });

  it('shows a generic failure outside the fields', async () => {
    mountForm();
    vi.mocked(marketplaceRepoSave).mockRejectedValue({
      kind: 'conflict',
      message: 'Se alcanzó el máximo de 100 repositorios.',
    });
    await press('Guardar');
    expect(bodyText()).toContain('Se alcanzó el máximo de 100 repositorios.');
  });

  it('asks to close with Cancelar', async () => {
    const form = mountForm();
    await press('Cancelar');
    expect(form.emitted('close')).toHaveLength(1);
  });
});

describe('RepoForm connection test', () => {
  it('shows success with the abbreviated uuid and the root', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    await fill('repo-form-url', RESULT.url);
    await press('Probar conexión');
    expect(bodyText()).toContain('Conexión correcta');
    expect(bodyText()).toContain('1234abcd');
    expect(bodyText()).not.toContain(UUID);
    expect(bodyText()).toContain(RESULT.root);
  });

  it('sends the typed url, user and the no-remember choice for a new repository', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    await fill('repo-form-url', 'svn://host/x');
    await fill('repo-form-username', ' ana ');
    input('repo-form-name').focus();
    const check = document.body.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    check.click();
    await press('Probar conexión');
    expect(lastTestArgs()).toEqual({
      url: 'svn://host/x',
      repo_id: null,
      username: 'ana',
      password: null,
      no_auth_cache: true,
      client_cert: null,
      client_cert_passphrase: null,
    });
  });

  it('uses repo_id when editing with the saved url, even with a trailing slash', async () => {
    mountForm(SAVED);
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    await fill('repo-form-url', `${SAVED.url}/`);
    await press('Probar conexión');
    expect(lastTestArgs().repo_id).toBe(4);
  });

  it('uses repo_id 0 for the repository with id 0', async () => {
    mountForm({ ...SAVED, id: 0 });
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    await press('Probar conexión');
    expect(lastTestArgs().repo_id).toBe(0);
  });

  it('drops repo_id when the url was changed while editing', async () => {
    mountForm(SAVED);
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    await fill('repo-form-url', 'https://otro.example.com/docs');
    await press('Probar conexión');
    expect(lastTestArgs().repo_id).toBeNull();
  });

  it('shows the classified error message without opening the credentials dialog', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValue({
      kind: 'network',
      message: 'No se pudo conectar con el servidor.',
    });
    await press('Probar conexión');
    expect(
      document.body.querySelector('[role="alert"].banner')?.textContent,
    ).toContain('No se pudo conectar con el servidor.');
    expect(bodyText()).not.toContain('Conexión correcta');
    expect(credentialsDialog()).toBeNull();
  });

  it('does not open the credentials dialog on permission_denied and shows its message', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValue({
      kind: 'permission_denied',
      message: 'El servidor denegó el acceso a este repositorio.',
    });
    await press('Probar conexión');
    expect(credentialsDialog()).toBeNull();
    expect(bodyText()).toContain(
      'El servidor denegó el acceso a este repositorio.',
    );
  });

  it('opens the credentials dialog on auth_required and retries with what was typed', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest)
      .mockRejectedValueOnce({ kind: 'auth_required', message: 'Pide acceso.' })
      .mockResolvedValue(RESULT);
    await fill('repo-form-url', 'svn://host/x');
    await press('Probar conexión');
    expect(credentialsDialog()).not.toBeNull();
    await submitCredentials('ana', SECRET);
    expect(vi.mocked(marketplaceRepoTest)).toHaveBeenCalledTimes(2);
    expect(lastTestArgs()).toMatchObject({
      url: 'svn://host/x',
      username: 'ana',
      password: SECRET,
    });
    expect(credentialsDialog()).toBeNull();
    expect(bodyText()).toContain('Conexión correcta');
  });

  it('keeps the password out of the store, the DOM and the form after the retry', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest)
      .mockRejectedValueOnce({ kind: 'auth_required', message: 'Pide acceso.' })
      .mockRejectedValue({
        kind: 'auth_required',
        message: 'Sigue sin acceso.',
      });
    await press('Probar conexión');
    await submitCredentials('ana', SECRET);
    expect(input('credentials-password').value).toBe('');
    expect(JSON.stringify(useMarketplaceStore().$state)).not.toContain(SECRET);
    expect(wrapper.html()).not.toContain(SECRET);
    const values = [...document.body.querySelectorAll('input')].map(
      (field) => field.value,
    );
    expect(values).not.toContain(SECRET);
  });

  it('cancelling the credentials dialog leaves the form open and the error visible', async () => {
    const form = mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValue({
      kind: 'auth_required',
      message: 'Pide acceso.',
    });
    await press('Probar conexión');
    const cancels = [...document.body.querySelectorAll('button')].filter(
      (candidate) => candidate.textContent?.trim() === 'Cancelar',
    );
    cancels[cancels.length - 1].click();
    await flushPromises();
    expect(credentialsDialog()).toBeNull();
    expect(form.emitted('close')).toBeUndefined();
    expect(bodyText()).toContain('Pide acceso.');
  });

  it('Escape with the credentials dialog open closes only that dialog', async () => {
    const form = mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValue({
      kind: 'auth_required',
      message: 'Pide acceso.',
    });
    await press('Probar conexión');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(credentialsDialog()).toBeNull();
    expect(form.emitted('close')).toBeUndefined();
  });

  it('disables the test button and announces progress while it runs', async () => {
    mountForm();
    let release: (value: RepoTestResult) => void = () => undefined;
    vi.mocked(marketplaceRepoTest).mockReturnValue(
      new Promise<RepoTestResult>((resolve) => (release = resolve)),
    );
    button('Probar conexión')!.click();
    await flushPromises();
    expect(button('Probando…')!.disabled).toBe(true);
    expect(button('Probar conexión')).toBeUndefined();
    expect(bodyText()).toContain('Probando la conexión…');
    release(RESULT);
    await flushPromises();
    expect(button('Probar conexión')!.disabled).toBe(false);
    expect(bodyText()).toContain('Conexión correcta');
  });
});

describe('RepoForm stale results and live regions', () => {
  async function succeedOnce() {
    vi.mocked(marketplaceRepoTest).mockResolvedValue(RESULT);
    await fill('repo-form-url', 'svn://host/a');
    await press('Probar conexión');
    expect(bodyText()).toContain('Conexión correcta');
  }

  it('drops «Conexión correcta» when the url changes after a successful test', async () => {
    mountForm();
    await succeedOnce();
    await fill('repo-form-url', 'svn://host/b');
    expect(bodyText()).not.toContain('Conexión correcta');
  });

  it('drops the result when the user or the no-remember choice changes', async () => {
    mountForm();
    await succeedOnce();
    await fill('repo-form-username', 'ana');
    expect(bodyText()).not.toContain('Conexión correcta');
    await press('Probar conexión');
    expect(bodyText()).toContain('Conexión correcta');
    document.body
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click();
    await flushPromises();
    expect(bodyText()).not.toContain('Conexión correcta');
  });

  it('drops an error shown for the previous url', async () => {
    mountForm();
    vi.mocked(marketplaceRepoTest).mockRejectedValue({
      kind: 'network',
      message: 'Sin conexión.',
    });
    await press('Probar conexión');
    expect(bodyText()).toContain('Sin conexión.');
    await fill('repo-form-url', 'svn://host/b');
    expect(bodyText()).not.toContain('Sin conexión.');
  });

  it('discards a test still running when the url changes', async () => {
    mountForm();
    let release: (value: RepoTestResult) => void = () => undefined;
    vi.mocked(marketplaceRepoTest).mockReturnValue(
      new Promise<RepoTestResult>((resolve) => (release = resolve)),
    );
    button('Probar conexión')!.click();
    await flushPromises();
    await fill('repo-form-url', 'svn://host/b');
    expect(button('Probar conexión')!.disabled).toBe(false);
    release(RESULT);
    await flushPromises();
    expect(bodyText()).not.toContain('Conexión correcta');
  });

  it('keeps persistent live regions for the test status and the http notice', async () => {
    mountForm();
    const status = document.body.querySelector('.repo-form__test-status');
    const notice = document.body.querySelector('.repo-form__notice');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(notice?.getAttribute('role')).toBe('status');
    await fill('repo-form-url', 'http://host/x');
    expect(notice?.textContent).toContain(HTTP_NOTICE);
    expect(document.body.querySelector('.repo-form__notice')).toBe(notice);
  });

  it('moves the focus to the invalid field after a save error', async () => {
    mountForm();
    vi.mocked(marketplaceRepoSave).mockRejectedValue({
      kind: 'invalid_path',
      message: 'La URL no es válida.',
    });
    await press('Guardar');
    expect(document.activeElement).toBe(input('repo-form-url'));
  });

  it('does not steal the focus for an error without a field', async () => {
    mountForm();
    vi.mocked(marketplaceRepoSave).mockRejectedValue({
      kind: 'conflict',
      message: 'Se alcanzó el máximo de 100 repositorios.',
    });
    button('Guardar')!.focus();
    await press('Guardar');
    expect(document.activeElement).toBe(button('Guardar'));
  });
});
