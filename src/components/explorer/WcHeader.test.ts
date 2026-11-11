import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { WcHeaderState } from '../../stores/explorer';
import type { CommandError, InfoEntry } from '../../services/tauri';
import WcHeader from './WcHeader.vue';

const info = {
  revision: 12,
  url: 'svn://host/repo/trunk',
  relative_url: '^/trunk',
  repository_root: 'svn://host/repo',
  working_copy_root: 'C:\\ws\\wc',
} as InfoEntry;

function header(extra: Partial<WcHeaderState> = {}): WcHeaderState {
  return { root: 'wc', info, error: null, isLoading: false, ...extra };
}

const failure = (
  kind: CommandError['kind'],
  message: string,
): CommandError => ({
  kind,
  message,
  codes: [],
  detail: null,
});

const show = (value: WcHeaderState | null) =>
  mount(WcHeader, { props: { header: value } });

describe('WcHeader outside a copy', () => {
  it('says it is a local folder', () => {
    const wrapper = show(null);
    expect(wrapper.text()).toContain('Carpeta local');
    expect(wrapper.text()).not.toContain('Working Copy');
  });
});

describe('WcHeader errors', () => {
  it('points an old-format copy to the bottom panel instead of repeating its guidance', () => {
    const wrapper = show(
      header({
        info: null,
        error: failure('working_copy_too_old', 'formato antiguo'),
      }),
    );
    expect(wrapper.text()).toContain('Working Copy');
    expect(wrapper.text()).toContain('revisa el panel inferior');
    expect(wrapper.text()).not.toContain('svn upgrade');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('dl').exists()).toBe(false);
  });

  it.each(['working_copy_locked', 'io'] as const)(
    'shows the same pointer note for a %s failure and never its message',
    (kind) => {
      const wrapper = show(
        header({ info: null, error: failure(kind, 'disco roto') }),
      );
      expect(wrapper.get('[role="status"]').text()).toBe(
        'No se pudo leer la copia: revisa el panel inferior.',
      );
      expect(wrapper.text()).not.toContain('disco roto');
    },
  );
});

describe('WcHeader facts', () => {
  it('shows a reading state while wc_info has not answered', () => {
    const wrapper = show(header({ info: null, isLoading: true }));
    expect(wrapper.text()).toContain('Leyendo la copia de trabajo');
  });

  it('falls back to dashes and the relative root when svn omits fields', () => {
    const wrapper = show(
      header({
        info: {
          revision: 3,
          url: null,
          relative_url: null,
          repository_root: null,
          working_copy_root: null,
        } as InfoEntry,
      }),
    );
    const values = wrapper.findAll('dd').map((item) => item.text());
    expect(values).toEqual(['-', '3', 'wc', '-']);
  });

  it('shows repository, revision, root and branch of a copy on trunk', () => {
    const wrapper = show(header());
    const rows = wrapper
      .findAll('.wc-header__fact')
      .map((row) => [row.get('dt').text(), row.get('dd').text()]);
    expect(rows).toEqual([
      ['Repositorio', 'svn://host/repo'],
      ['Revisión', '12'],
      ['Raíz', 'C:\\ws\\wc'],
      ['Rama', '^/trunk'],
    ]);
    expect(wrapper.text()).toContain('Working Copy');
  });

  it('shows a branch and the relative url of a custom layout as they are', () => {
    const onBranch = show(
      header({
        info: { ...info, relative_url: '^/branches/x/sub' } as InfoEntry,
      }),
    );
    expect(onBranch.text()).toContain('^/branches/x');
    const custom = show(
      header({ info: { ...info, relative_url: '^/otra/cosa' } as InfoEntry }),
    );
    expect(custom.text()).toContain('^/otra/cosa');
  });
});
