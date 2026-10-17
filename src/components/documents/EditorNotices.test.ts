import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { CommandError } from '../../services/tauri';
import EditorNotices from './EditorNotices.vue';

function failure(kind: CommandError['kind'], message = 'x'): CommandError {
  return { kind, message, codes: [], detail: null };
}

describe('EditorNotices', () => {
  it('no muestra nada sin solo lectura ni error', () => {
    const wrapper = mount(EditorNotices, {
      props: { isReadOnly: false, error: null },
    });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('el aviso de solo lectura gana sobre un error y ofrece reintentar y recargar', async () => {
    const wrapper = mount(EditorNotices, {
      props: { isReadOnly: true, error: failure('io') },
    });
    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain('solo lectura');
    expect(alert.text()).toContain('svn:needs-lock');
    expect(alert.text()).not.toContain('No se pudo guardar');

    const [retry, reload] = alert.findAll('button');
    await retry.trigger('click');
    await reload.trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
    expect(wrapper.emitted('reload')).toHaveLength(1);
  });

  it('un error de guardado muestra su explicación y reintentar lo repite', async () => {
    const wrapper = mount(EditorNotices, {
      props: { isReadOnly: false, error: failure('file_locked') },
    });
    expect(wrapper.get('[role="alert"]').text()).toContain('en uso por otro');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
    expect(wrapper.emitted('reload')).toBeUndefined();
  });

  it('un error desconocido conserva el mensaje del sistema', () => {
    const wrapper = mount(EditorNotices, {
      props: { isReadOnly: false, error: failure('io', 'disco lleno') },
    });
    expect(wrapper.text()).toContain('No se pudo guardar: disco lleno');
  });
});
