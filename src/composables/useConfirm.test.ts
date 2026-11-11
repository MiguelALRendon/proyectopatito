import { describe, expect, it } from 'vitest';
import { confirm, resolveConfirm, useConfirm } from './useConfirm';

describe('useConfirm title', () => {
  it('shows the given title while pending and restores the default after', async () => {
    const { title } = useConfirm();
    const defaultTitle = title.value;
    const answer = confirm('¿Seguro?', 'Sí', '¿Cancelar la operación?');
    expect(title.value).toBe('¿Cancelar la operación?');
    resolveConfirm(true);
    await answer;
    expect(title.value).toBe(defaultTitle);
  });
});

describe('useConfirm', () => {
  it('ignores a resolution when nothing is pending', () => {
    const { message } = useConfirm();
    expect(() => resolveConfirm(true)).not.toThrow();
    expect(message.value).toBeNull();
  });

  it('cancels the previous question when a new one arrives', async () => {
    const first = confirm('primera');
    const second = confirm('segunda');
    await expect(first).resolves.toBe(false);
    resolveConfirm(true);
    await expect(second).resolves.toBe(true);
  });

  it('shows the message and custom label while pending, then resets them', async () => {
    const { message, confirmLabel } = useConfirm();
    const answer = confirm('¿Cancelar la operación?', 'Cancelar operación');
    expect(message.value).toBe('¿Cancelar la operación?');
    expect(confirmLabel.value).toBe('Cancelar operación');
    resolveConfirm(false);
    await expect(answer).resolves.toBe(false);
    expect(message.value).toBeNull();
    expect(confirmLabel.value).toBe('Aceptar');
  });

  it('uses the default label when none is given and resolves true on accept', async () => {
    const { confirmLabel } = useConfirm();
    const answer = confirm('¿Seguro?');
    expect(confirmLabel.value).toBe('Aceptar');
    resolveConfirm(true);
    await expect(answer).resolves.toBe(true);
  });
});
