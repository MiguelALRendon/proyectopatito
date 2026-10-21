import { describe, expect, it } from 'vitest';
import {
  OFFICE_ERROR_CODES,
  OFFICE_FORMATS,
  OFFICE_KINDS,
  isOfficeFormat,
  parseHostMessage,
} from './officeProtocol';

describe('parseHostMessage: lo que nunca debe aceptarse', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['un número', 7],
    ['una cadena', 'ready'],
    ['una lista', [{ cmd: 'ready' }]],
    ['un objeto vacío', {}],
    ['cmd que no es cadena', { cmd: 5 }],
    ['cmd desconocido', { cmd: 'format-disk' }],
    ['cmd heredado del prototipo', { cmd: 'constructor' }],
    ['cmd __proto__', { cmd: '__proto__' }],
    ['cmd toString', { cmd: 'toString' }],
  ])('rechaza %s', (_name, data) => {
    expect(parseHostMessage(data)).toBeNull();
  });

  it.each([
    ['progress sin números', { cmd: 'progress', loaded: '1', total: 2 }],
    ['progress negativo', { cmd: 'progress', loaded: -1, total: 2 }],
    ['progress fraccionario', { cmd: 'progress', loaded: 0.5, total: 2 }],
    ['progress con NaN', { cmd: 'progress', loaded: NaN, total: 2 }],
    ['progress con Infinity', { cmd: 'progress', loaded: 1, total: Infinity }],
    ['progress mayor que el total', { cmd: 'progress', loaded: 3, total: 2 }],
    ['opened sin docId', { cmd: 'opened', kind: 'writer' }],
    ['opened con docId vacío', { cmd: 'opened', docId: '', kind: 'writer' }],
    ['opened con docId numérico', { cmd: 'opened', docId: 5, kind: 'writer' }],
    [
      'opened con kind desconocido',
      { cmd: 'opened', docId: 'a', kind: 'draw' },
    ],
    [
      'opened con docId gigante',
      { cmd: 'opened', docId: 'x'.repeat(401), kind: 'calc' },
    ],
    ['closed sin docId', { cmd: 'closed' }],
    ['modified con docId nulo', { cmd: 'modified', docId: null }],
    ['save-requested sin docId', { cmd: 'save-requested' }],
    ['blocked sin comando', { cmd: 'blocked' }],
    [
      'blocked con comando gigante',
      { cmd: 'blocked', command: 'x'.repeat(401) },
    ],
    [
      'error con código desconocido',
      { cmd: 'error', code: 'boom', detail: '' },
    ],
    ['error sin detalle', { cmd: 'error', code: 'busy' }],
    [
      'error con docId no textual',
      { cmd: 'error', code: 'busy', detail: '', docId: 3 },
    ],
  ])('rechaza %s', (_name, data) => {
    expect(parseHostMessage(data)).toBeNull();
  });
});

describe('parseHostMessage: mensajes válidos', () => {
  it('acepta cada tipo y descarta los campos sobrantes', () => {
    expect(parseHostMessage({ cmd: 'ready', extra: 1 })).toEqual({
      cmd: 'ready',
    });
    expect(parseHostMessage({ cmd: 'progress', loaded: 2, total: 2 })).toEqual({
      cmd: 'progress',
      loaded: 2,
      total: 2,
    });
    expect(parseHostMessage({ cmd: 'closed', docId: 'a', x: 1 })).toEqual({
      cmd: 'closed',
      docId: 'a',
    });
    expect(parseHostMessage({ cmd: 'modified', docId: 'a' })).toEqual({
      cmd: 'modified',
      docId: 'a',
    });
    expect(parseHostMessage({ cmd: 'save-requested', docId: 'a' })).toEqual({
      cmd: 'save-requested',
      docId: 'a',
    });
    expect(parseHostMessage({ cmd: 'blocked', command: '.uno:Open' })).toEqual({
      cmd: 'blocked',
      command: '.uno:Open',
    });
  });

  it.each(OFFICE_KINDS)('acepta opened con kind %s', (kind) => {
    expect(parseHostMessage({ cmd: 'opened', docId: 'a', kind })).toEqual({
      cmd: 'opened',
      docId: 'a',
      kind,
    });
  });

  it.each(OFFICE_ERROR_CODES)(
    'acepta error con código %s, con y sin docId',
    (code) => {
      expect(parseHostMessage({ cmd: 'error', code, detail: 'x' })).toEqual({
        cmd: 'error',
        code,
        detail: 'x',
      });
      expect(
        parseHostMessage({ cmd: 'error', code, detail: '', docId: 'a' }),
      ).toEqual({
        cmd: 'error',
        code,
        detail: '',
        docId: 'a',
      });
    },
  );

  it('acepta un guardado solicitado y uno no solicitado y conserva los bytes', () => {
    const bytes = new Uint8Array([1, 2]).buffer;
    for (const requested of [true, false]) {
      const parsed = parseHostMessage({
        cmd: 'saved',
        docId: 'a',
        requested,
        bytes,
      });
      expect(parsed).toEqual({ cmd: 'saved', docId: 'a', requested, bytes });
    }
  });

  it.each([
    ['sin docId', { requested: true, bytes: new ArrayBuffer(1) }],
    [
      'con docId vacío',
      { docId: '', requested: true, bytes: new ArrayBuffer(1) },
    ],
    [
      'con requested no booleano',
      { docId: 'a', requested: 'si', bytes: new ArrayBuffer(1) },
    ],
    ['sin requested', { docId: 'a', bytes: new ArrayBuffer(1) }],
    [
      'con bytes que no son ArrayBuffer',
      { docId: 'a', requested: true, bytes: new Uint8Array(1) },
    ],
    ['sin bytes', { docId: 'a', requested: true }],
  ])('rechaza un guardado %s', (_name, fields) => {
    expect(parseHostMessage({ cmd: 'saved', ...fields })).toBeNull();
  });

  it('acepta un guardado vacío (la longitud la decide quien escribe)', () => {
    expect(
      parseHostMessage({
        cmd: 'saved',
        docId: 'a',
        requested: true,
        bytes: new ArrayBuffer(0),
      }),
    ).not.toBeNull();
  });

  it('acepta un progreso en cero y completo', () => {
    expect(
      parseHostMessage({ cmd: 'progress', loaded: 0, total: 0 }),
    ).not.toBeNull();
    expect(
      parseHostMessage({ cmd: 'progress', loaded: 5, total: 5 }),
    ).not.toBeNull();
  });
});

describe('isOfficeFormat', () => {
  it.each(OFFICE_FORMATS)('reconoce %s', (format) => {
    expect(isOfficeFormat(format)).toBe(true);
  });

  it.each([
    '',
    'DOCX',
    'docx ',
    'rtf',
    'csv',
    'pdf',
    'exe',
    'toString',
    null,
    5,
  ])('rechaza %s', (value) => {
    expect(isOfficeFormat(value)).toBe(false);
  });

  it('son exactamente las nueve extensiones de la 2B', () => {
    expect([...OFFICE_FORMATS].sort()).toEqual(
      ['doc', 'docx', 'ods', 'odp', 'odt', 'ppt', 'pptx', 'xls', 'xlsx'].sort(),
    );
  });
});
