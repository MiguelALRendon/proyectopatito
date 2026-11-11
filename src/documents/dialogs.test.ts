import { describe, expect, it } from 'vitest';
import { resolveChoice, useChoice } from '../composables/useChoice';
import {
  askCloseAnyway,
  askConflict,
  askLegacyFidelity,
  askLineEnding,
  askSwitchOffice,
  askWindowClose,
  pluralTabs,
} from './dialogs';

const { request } = useChoice();

function labels(): string[] {
  return request.value?.options.map((option) => option.label) ?? [];
}

describe('askConflict', () => {
  it('ofrece cancelar primero, recargar y sobrescribir, y explica el riesgo', async () => {
    const answer = askConflict('notas.txt');
    expect(labels()).toEqual([
      'Cancelar',
      'Recargar (descarta mis cambios)',
      'Sobrescribir (pisa los cambios externos)',
    ]);
    expect(request.value?.message).toContain('notas.txt');
    expect(request.value?.message).toContain('se pierden');
    resolveChoice(null);
    await answer;
  });

  it.each([
    ['reload', 'reload'],
    ['overwrite', 'overwrite'],
    ['cancel', null],
    [null, null],
  ] as const)('la opción %s devuelve %s', async (picked, expected) => {
    const answer = askConflict('a.txt');
    resolveChoice(picked);
    expect(await answer).toBe(expected);
  });

  it('marca sobrescribir como acción peligrosa', async () => {
    const answer = askConflict('a.txt');
    const tones = request.value?.options.map((option) => option.tone);
    expect(tones).toEqual([undefined, undefined, 'danger']);
    resolveChoice(null);
    await answer;
  });
});

describe('askLineEnding', () => {
  it('cuando predomina CRLF ofrece usar LF o conservar CRLF', async () => {
    const answer = askLineEnding('a.txt', 'crlf');
    expect(labels()).toEqual([
      'Cancelar',
      'Usar LF',
      'Conservar el dominante (CRLF)',
    ]);
    expect(request.value?.message).toContain('predomina CRLF');
    resolveChoice(null);
    await answer;
  });

  it('cuando predomina LF ofrece usar CRLF o conservar LF', async () => {
    const answer = askLineEnding('a.txt', 'lf');
    expect(labels()).toEqual([
      'Cancelar',
      'Usar CRLF',
      'Conservar el dominante (LF)',
    ]);
    resolveChoice(null);
    await answer;
  });

  it.each([
    ['lf', 'lf'],
    ['crlf', 'crlf'],
    ['cancel', null],
    [null, null],
  ] as const)('la opción %s devuelve %s', async (picked, expected) => {
    const answer = askLineEnding('a.txt', 'crlf');
    resolveChoice(picked);
    expect(await answer).toBe(expected);
  });
});

describe('askWindowClose', () => {
  it('cancelar y descartar van primero y guardar es la acción principal', async () => {
    const answer = askWindowClose(2);
    expect(labels()).toEqual([
      'Cancelar',
      'Cerrar sin guardar',
      'Guardar y cerrar',
    ]);
    expect(request.value?.message).toContain('2 pestañas tienen');
    resolveChoice(null);
    await answer;
  });

  it.each([
    ['save', 'save'],
    ['discard', 'discard'],
    ['cancel', null],
    [null, null],
  ] as const)('la opción %s devuelve %s', async (picked, expected) => {
    const answer = askWindowClose(1);
    resolveChoice(picked);
    expect(await answer).toBe(expected);
  });
});

describe('askCloseAnyway', () => {
  it('explica que no se pudo comprobar y ofrece cancelar antes que cerrar de todos modos', async () => {
    const answer = askCloseAnyway();
    expect(request.value?.title).toBe(
      'No se pudo comprobar si hay cambios sin guardar',
    );
    expect(labels()).toEqual(['Cancelar', 'Cerrar de todos modos']);
    expect(request.value?.options[1].tone).toBe('danger');
    resolveChoice(null);
    await answer;
  });

  it.each([
    ['close-anyway', true],
    ['cancel', false],
    [null, false],
  ] as const)('la opción %s devuelve %s', async (picked, expected) => {
    const answer = askCloseAnyway();
    resolveChoice(picked);
    expect(await answer).toBe(expected);
  });
});

describe('pluralTabs', () => {
  it('concuerda el verbo con el número', () => {
    expect(pluralTabs(1)).toBe('1 pestaña tiene');
    expect(pluralTabs(3)).toBe('3 pestañas tienen');
  });
});

describe('askLegacyFidelity', () => {
  it('ofrece cancelar y guardar de todos modos, y nombra el archivo', async () => {
    const answer = askLegacyFidelity('viejo.doc');
    expect(labels()).toEqual(['Cancelar', 'Guardar de todos modos']);
    expect(request.value?.message).toContain('viejo.doc');
    expect(request.value?.message).toContain('formato');
    resolveChoice('proceed');
    expect(await answer).toBe(true);
  });

  it.each([
    ['cancelar', 'cancel'],
    ['cerrar sin elegir', null],
  ])('al %s devuelve falso', async (_name, value) => {
    const answer = askLegacyFidelity('viejo.doc');
    resolveChoice(value);
    expect(await answer).toBe(false);
  });
});

describe('askSwitchOffice', () => {
  it('explica que solo hay un documento a la vez y ofrece cancelar, descartar y guardar', async () => {
    const answer = askSwitchOffice('informe.docx');
    expect(labels()).toEqual([
      'Cancelar',
      'Descartar los cambios',
      'Guardar y continuar',
    ]);
    expect(request.value?.message).toContain('informe.docx');
    expect(request.value?.message).toContain(
      'un documento de Office abierto a la vez',
    );
    resolveChoice('save');
    expect(await answer).toBe('save');
  });

  it('descartar devuelve discard', async () => {
    const answer = askSwitchOffice('a.docx');
    resolveChoice('discard');
    expect(await answer).toBe('discard');
  });

  it.each([
    ['cancelar', 'cancel'],
    ['cerrar sin elegir', null],
  ])('al %s devuelve null', async (_name, value) => {
    const answer = askSwitchOffice('a.docx');
    resolveChoice(value);
    expect(await answer).toBeNull();
  });
});
