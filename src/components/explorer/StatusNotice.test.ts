import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { StatusOverlay } from '../../stores/explorer';
import type { CommandError, ErrorKind } from '../../services/tauri';
import StatusNotice from './StatusNotice.vue';

function overlay(extra: Partial<StatusOverlay> = {}): StatusOverlay {
  return {
    root: 'wc',
    isRemote: false,
    isLoading: false,
    isCheckingServer: false,
    index: null,
    truncated: false,
    error: null,
    againstRevision: null,
    ...extra,
  };
}

const failure = (kind: ErrorKind, message = 'falló'): CommandError => ({
  kind,
  message,
  codes: [],
  detail: null,
});

function render(
  status: StatusOverlay,
  headerErrorKind: ErrorKind | null = null,
) {
  return mount(StatusNotice, { props: { status, headerErrorKind } });
}

describe('StatusNotice failures', () => {
  it('says that the status could not be calculated, as a polite status', () => {
    const wrapper = render(
      overlay({ error: failure('timed_out', 'tardó demasiado') }),
    );
    const banner = wrapper.get('.banner');
    expect(banner.attributes('role')).toBe('status');
    expect(banner.text()).toContain('No se pudo calcular el estado');
    expect(banner.text()).toContain('tardó demasiado');
  });

  it('offers the credentials when the server asks for them', async () => {
    const wrapper = render(overlay({ error: failure('auth_required') }));
    expect(wrapper.text()).toContain('credenciales');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('askCredentials')).toHaveLength(1);
  });

  it('offers no credentials button for other failures', () => {
    const wrapper = render(overlay({ error: failure('svn_failed') }));
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('does not repeat a message the copy header already explains', () => {
    const old = overlay({ error: failure('working_copy_too_old') });
    expect(render(old, 'working_copy_too_old').find('.banner').exists()).toBe(
      false,
    );
    expect(render(old, null).text()).toContain('svn upgrade');
  });

  it('still shows an unguided error even if the header failed with the same kind', () => {
    const wrapper = render(
      overlay({ error: failure('svn_failed', 'raro') }),
      'svn_failed',
    );
    expect(wrapper.text()).toContain('raro');
  });

  it('hides the failure while a new calculation is running', () => {
    const wrapper = render(
      overlay({ isLoading: true, error: failure('svn_failed') }),
    );
    expect(wrapper.find('.banner').exists()).toBe(false);
  });
});

describe('StatusNotice truncated answers', () => {
  it('warns that some badges may be missing', () => {
    const wrapper = render(overlay({ truncated: true }));
    const warning = wrapper.get('.banner');
    expect(warning.attributes('role')).toBe('status');
    expect(warning.text()).toContain('demasiados cambios');
  });

  it('is silent for a complete answer', () => {
    expect(render(overlay()).text()).toBe('');
  });
});

describe('StatusNotice progress', () => {
  it('shows that the status is being calculated', () => {
    const wrapper = render(overlay({ isLoading: true }));
    expect(wrapper.get('[role="status"]').text()).toContain(
      'Calculando el estado',
    );
  });

  it('shows a different text while the server is being checked', () => {
    const wrapper = render(
      overlay({ isLoading: true, isCheckingServer: true }),
    );
    expect(wrapper.text()).toContain('Comprobando el servidor');
    expect(wrapper.text()).not.toContain('Calculando');
  });

  it('hides the animated bar from assistive technology', () => {
    const wrapper = render(overlay({ isLoading: true }));
    expect(wrapper.get('.status-notice__bar').attributes('aria-hidden')).toBe(
      'true',
    );
  });
});

describe('StatusNotice server comparison', () => {
  it('names the revision it was compared with', () => {
    const wrapper = render(overlay({ isRemote: true, againstRevision: 7 }));
    expect(wrapper.text()).toBe(
      'Estado comparado con el servidor (revisión 7).',
    );
  });

  it('does not claim a comparison it did not make', () => {
    expect(render(overlay({ againstRevision: 7 })).text()).toBe('');
    const failed = overlay({ isRemote: true, error: failure('io') });
    expect(render(failed).text()).not.toContain('comparado');
  });

  it('omits the revision when the server did not report it', () => {
    const wrapper = render(overlay({ isRemote: true }));
    expect(wrapper.text()).toBe('Estado comparado con el servidor.');
  });
});
