import { describe, expect, it } from 'vitest';
import { choose, resolveChoice, useChoice } from './useChoice';

const QUESTION = {
  title: 'Título',
  message: 'Pregunta',
  options: [
    { value: 'a', label: 'Opción A' },
    { value: 'b', label: 'Opción B', tone: 'danger' as const },
  ],
};

describe('useChoice', () => {
  it('ignora una resolución cuando no hay nada pendiente', () => {
    const { request } = useChoice();
    expect(() => resolveChoice('a')).not.toThrow();
    expect(request.value).toBeNull();
  });

  it('descartar el diálogo resuelve con null', async () => {
    const answer = choose(QUESTION);
    resolveChoice(null);
    await expect(answer).resolves.toBeNull();
  });

  it('una pregunta nueva cancela la anterior con null', async () => {
    const first = choose(QUESTION);
    const second = choose({ ...QUESTION, message: 'Otra' });
    await expect(first).resolves.toBeNull();
    resolveChoice('b');
    await expect(second).resolves.toBe('b');
  });

  it('una segunda resolución sobre la misma pregunta no cambia el resultado', async () => {
    const answer = choose(QUESTION);
    resolveChoice('a');
    resolveChoice('b');
    await expect(answer).resolves.toBe('a');
  });

  it('muestra la pregunta mientras está pendiente y la limpia al resolver', async () => {
    const { request } = useChoice();
    const answer = choose(QUESTION);
    expect(request.value?.message).toBe('Pregunta');
    expect(request.value?.options).toHaveLength(2);
    resolveChoice('a');
    await answer;
    expect(request.value).toBeNull();
  });
});
