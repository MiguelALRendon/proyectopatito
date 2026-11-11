import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { choose, resolveChoice } from '../composables/useChoice';
import ChoiceDialog from './ChoiceDialog.vue';

const QUESTION = {
  title: 'Cambios sin guardar',
  message: '¿Qué hacemos?',
  options: [
    { value: 'cancel', label: 'Cancelar' },
    { value: 'discard', label: 'Descartar', tone: 'danger' as const },
    { value: 'save', label: 'Guardar', tone: 'primary' as const },
  ],
};

let wrapper: VueWrapper;

function mountDialog() {
  wrapper = mount(ChoiceDialog, { attachTo: document.body });
  return wrapper;
}

const dialog = () => document.body.querySelector('[role="alertdialog"]');

afterEach(() => {
  resolveChoice(null);
  wrapper.unmount();
});

describe('ChoiceDialog', () => {
  it('no muestra nada mientras no hay pregunta', () => {
    mountDialog();
    expect(dialog()).toBeNull();
  });

  it('Escape descarta el diálogo con null', async () => {
    mountDialog();
    const answer = choose(QUESTION);
    await flushPromises();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(answer).resolves.toBeNull();
    await flushPromises();
    expect(dialog()).toBeNull();
  });

  it('un clic en el fondo no decide por el usuario', async () => {
    mountDialog();
    const answer = choose(QUESTION);
    await flushPromises();
    let isSettled = false;
    void answer.then(() => (isSettled = true));
    (
      document.body.querySelector('.base-modal__overlay') as HTMLElement
    ).click();
    await flushPromises();
    expect(isSettled).toBe(false);
    expect(dialog()).not.toBeNull();
  });

  it('muestra título, mensaje y un botón por opción, y el primero recibe el foco', async () => {
    mountDialog();
    void choose(QUESTION);
    await flushPromises();
    const buttons = [...document.body.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Cancelar',
      'Descartar',
      'Guardar',
    ]);
    expect(dialog()?.textContent).toContain('Cambios sin guardar');
    expect(dialog()?.textContent).toContain('¿Qué hacemos?');
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('aplica el tono de cada opción', async () => {
    mountDialog();
    void choose(QUESTION);
    await flushPromises();
    const buttons = [...document.body.querySelectorAll('button')];
    expect(buttons[0].className).not.toContain('btn--');
    expect(buttons[1].classList.contains('btn--danger')).toBe(true);
    expect(buttons[2].classList.contains('btn--primary')).toBe(true);
  });

  it('pulsar una opción resuelve con su valor y cierra el diálogo', async () => {
    mountDialog();
    const answer = choose(QUESTION);
    await flushPromises();
    (document.body.querySelectorAll('button')[2] as HTMLElement).click();
    await expect(answer).resolves.toBe('save');
    await flushPromises();
    expect(dialog()).toBeNull();
  });
});
