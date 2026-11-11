import { describe, expect, it } from 'vitest';
import type { TextDocument } from '../services/filesApi';
import type { CommandError, ErrorKind } from '../services/tauri';
import { describeDocument, describeSaveError } from './labels';

function sample(extra: Partial<TextDocument> = {}): TextDocument {
  return {
    content: '',
    encoding: 'utf8',
    has_bom: false,
    eol: 'lf',
    eol_mixed: false,
    version: '1',
    len: 0,
    ...extra,
  };
}

describe('describeDocument', () => {
  it('describe UTF-16 con BOM y CRLF', () => {
    const facts = describeDocument(
      sample({ encoding: 'utf16_le', has_bom: true, eol: 'crlf' }),
    );
    expect(facts).toEqual({
      encoding: 'UTF-16 LE',
      bom: 'con BOM',
      eol: 'CRLF',
      mixedEolNotice: null,
    });
  });

  it('avisa del fin de línea mixto con el dominante', () => {
    const facts = describeDocument(sample({ eol: 'crlf', eol_mixed: true }));
    expect(facts.mixedEolNotice).toBe('Fin de línea mixto: predomina CRLF.');
  });

  it('describe UTF-8 sin BOM y LF', () => {
    const facts = describeDocument(sample());
    expect([facts.encoding, facts.bom, facts.eol]).toEqual([
      'UTF-8',
      'sin BOM',
      'LF',
    ]);
  });

  it('describe UTF-16 BE', () => {
    expect(describeDocument(sample({ encoding: 'utf16_be' })).encoding).toBe(
      'UTF-16 BE',
    );
  });
});

function failure(
  kind: ErrorKind,
  message = 'detalle del sistema',
): CommandError {
  return { kind, message, codes: [], detail: null };
}

describe('describeSaveError', () => {
  it.each([
    ['file_locked', 'en uso por otro programa'],
    ['working_copy_busy', 'ocupada con otra operación de Subversion'],
    ['too_large', 'supera el tamaño máximo'],
    ['not_text', 'ya no es texto'],
    ['cloud_only', 'solo en la nube'],
  ] as const)(
    'explica %s en español y sin el mensaje técnico',
    (kind, text) => {
      const notice = describeSaveError(failure(kind));
      expect(notice).toContain(text);
      expect(notice).not.toContain('detalle del sistema');
    },
  );

  it('para un error desconocido conserva el mensaje del sistema', () => {
    expect(describeSaveError(failure('io', 'disco lleno'))).toBe(
      'No se pudo guardar: disco lleno',
    );
  });
});
