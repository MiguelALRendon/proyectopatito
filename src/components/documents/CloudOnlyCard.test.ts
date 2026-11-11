import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { CommandError } from '../../services/tauri';
import CloudOnlyCard from './CloudOnlyCard.vue';

const THREE_MIB = 3 * 1024 * 1024;

let wrapper: VueWrapper;

function mountCard(isDownloading = false, error: CommandError | null = null) {
  wrapper = mount(CloudOnlyCard, {
    props: { path: 'a\\nube.docx', size: THREE_MIB, isDownloading, error },
  });
  return wrapper;
}

afterEach(() => wrapper.unmount());

describe('CloudOnlyCard', () => {
  it('mientras descarga deshabilita el botón y no emite de nuevo', async () => {
    mountCard(true);
    const button = wrapper.get('button');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('aria-busy')).toBe('true');
    expect(button.text()).toContain('Descargando');
    await button.trigger('click');
    expect(wrapper.emitted('download')).toBeUndefined();
  });

  it('muestra el error de descarga como alerta', () => {
    mountCard(false, {
      kind: 'io',
      message: 'sin conexión',
      codes: [],
      detail: null,
    });
    expect(wrapper.get('[role="alert"]').text()).toContain('sin conexión');
  });

  it('sin error no hay alerta', () => {
    mountCard();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('muestra nombre, tamaño y emite download al pulsar «Descargar y abrir»', async () => {
    mountCard();
    expect(wrapper.get('button').attributes('aria-busy')).toBe('false');
    expect(wrapper.text()).toContain('nube.docx');
    expect(wrapper.text()).toContain('solo en la nube');
    expect(wrapper.text()).toContain('Tamaño: 3 MB');
    await wrapper.get('button').trigger('click');
    expect(wrapper.text()).toContain('Descargar y abrir');
    expect(wrapper.emitted('download')).toHaveLength(1);
  });
});
