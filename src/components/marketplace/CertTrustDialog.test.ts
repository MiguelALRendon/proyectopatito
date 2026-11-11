import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import {
  TRUST_FAILURES,
  type CertPrompt,
  type TrustFailure,
} from '../../services/marketplaceApi';
import { TRUST_FAILURE_LABELS } from '../../utils/certLabels';
import { formatDate } from '../../utils/svnLabels';
import CertTrustDialog from './CertTrustDialog.vue';

const SHA = 'abcdef0123456789'.repeat(4);
const FIXED_NOTICE =
  'Confiar solo afecta a este servidor y a este certificado; si el servidor presenta otro distinto se te volverá a preguntar.';

function promptWith(
  reasons: TrustFailure[],
  issuer = 'CN=svn.example.com',
): CertPrompt {
  return {
    info: {
      host: 'svn.example.com',
      port: 8443,
      sha256: SHA,
      subject: 'CN=svn.example.com',
      issuer,
      not_before: '2026-01-01T00:00:00Z',
      not_after: '2027-01-01T00:00:00Z',
    },
    reasons,
  };
}

let wrapper: VueWrapper;

function mountDialog(prompt: CertPrompt, isBusy = false) {
  wrapper = mount(CertTrustDialog, {
    props: { prompt, isBusy },
    attachTo: document.body,
  });
  return wrapper;
}

const text = () => document.body.textContent ?? '';
const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;

afterEach(() => wrapper.unmount());

describe('CertTrustDialog content', () => {
  it('names the dialog and shows server, issuer, subject, validity and fingerprint', () => {
    mountDialog(promptWith(['unknown-ca'], 'CN=Autoridad'));
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe('cert-trust-title');
    expect(document.body.querySelector('#cert-trust-title')?.textContent).toBe(
      'Certificado no confiable',
    );
    expect(text()).toContain('svn.example.com:8443');
    expect(text()).toContain('CN=Autoridad');
    expect(text()).toContain('CN=svn.example.com');
    expect(text()).toContain(
      `${formatDate('2026-01-01T00:00:00Z')} – ${formatDate('2027-01-01T00:00:00Z')}`,
    );
  });

  it('shows the SHA-256 in uppercase pairs, selectable and monospaced', () => {
    mountDialog(promptWith(['unknown-ca']));
    const fingerprint = document.body.querySelector('.cert-trust__fingerprint')!;
    expect(fingerprint.textContent).toBe(
      Array(4).fill('AB:CD:EF:01:23:45:67:89').join(':'),
    );
    expect(fingerprint.tagName).toBe('CODE');
  });

  it.each(TRUST_FAILURES)('explains the reason «%s» in Spanish', (reason) => {
    mountDialog(promptWith([reason]));
    const items = [...document.body.querySelectorAll('#cert-trust-reasons li')];
    expect(items.map((item) => item.textContent)).toEqual([
      TRUST_FAILURE_LABELS[reason],
    ]);
  });

  it('lists every reason and describes the dialog with them', () => {
    mountDialog(promptWith(['expired', 'cn-mismatch']));
    expect(
      document.body.querySelectorAll('#cert-trust-reasons li'),
    ).toHaveLength(2);
    expect(
      document.body
        .querySelector('[role="dialog"]')
        ?.getAttribute('aria-describedby'),
    ).toBe('cert-trust-reasons');
  });

  it('states the fixed scope of the trust', () => {
    mountDialog(promptWith(['unknown-ca']));
    expect(text()).toContain(FIXED_NOTICE);
  });
});

describe('CertTrustDialog actions', () => {
  it('focuses Cancelar first and accepts nothing by default', () => {
    const view = mountDialog(promptWith(['unknown-ca']));
    expect(document.activeElement).toBe(button('Cancelar'));
    expect(view.emitted('trust')).toBeUndefined();
    expect(view.emitted('cancel')).toBeUndefined();
  });

  it('emits cancel from Cancelar, from Escape and not from the backdrop', () => {
    const view = mountDialog(promptWith(['unknown-ca']));
    document.body
      .querySelector<HTMLElement>('.base-modal__overlay')!
      .click();
    expect(view.emitted('cancel')).toBeUndefined();
    button('Cancelar')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(view.emitted('cancel')).toHaveLength(2);
    expect(view.emitted('trust')).toBeUndefined();
  });

  it('emits trust only from the explicit button', () => {
    const view = mountDialog(promptWith(['unknown-ca']));
    button('Confiar en este certificado')!.click();
    expect(view.emitted('trust')).toHaveLength(1);
  });

  it('suggests importing the authority when it is signed by another issuer', () => {
    const view = mountDialog(promptWith(['unknown-ca'], 'CN=Empresa CA'));
    expect(text()).toContain(
      'Está firmado por «CN=Empresa CA». Si tu empresa te dio el certificado de esa autoridad, es mejor importarlo.',
    );
    button('Importar autoridad…')!.click();
    expect(view.emitted('importAuthority')).toHaveLength(1);
  });

  it.each([
    ['self-signed', promptWith(['unknown-ca'])],
    ['another issuer without unknown-ca', promptWith(['expired'], 'CN=Otra')],
  ])('hides the authority note when %s', (_, prompt) => {
    mountDialog(prompt);
    expect(text()).not.toContain('Está firmado por');
    expect(button('Importar autoridad…')).toBeUndefined();
  });

  it('disables trust and import while busy but keeps Cancelar and a live status', () => {
    const view = mountDialog(promptWith(['unknown-ca'], 'CN=Empresa CA'), true);
    expect(button('Confiar en este certificado')!.disabled).toBe(true);
    expect(button('Importar autoridad…')!.disabled).toBe(true);
    expect(button('Cancelar')!.disabled).toBe(false);
    const status = document.body.querySelector('.cert-trust__status')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toBe('Procesando…');
    return view.setProps({ isBusy: false }).then(() => {
      expect(document.body.querySelector('.cert-trust__status')).toBe(status);
      expect(status.textContent).toBe('');
    });
  });
});
