import { describe, expect, it } from 'vitest';
import {
  errorGuidance,
  formatProgressLine,
  isValidFolderName,
  formatDate,
  itemLabel,
} from './svnLabels';

describe('isValidFolderName', () => {
  it.each([
    '',
    '.',
    '..',
    'a/b',
    'a\\b',
    'a:b',
    'a*b',
    'a?b',
    'a"b',
    'a<b',
    'a|b',
  ])('rejects %j', (name) => expect(isValidFolderName(name)).toBe(false));

  it.each(['copia', 'ñandú 1', 'wc@dir', '.oculta'])('accepts %j', (name) =>
    expect(isValidFolderName(name)).toBe(true),
  );
});

describe('itemLabel', () => {
  it('translates known svn items with a tone', () => {
    expect(itemLabel('modified')).toEqual({
      label: 'Modificado',
      tone: 'warning',
    });
    expect(itemLabel('conflicted').tone).toBe('danger');
  });

  it('has a Spanish label and tone for every svn item', () => {
    const expected: Record<string, [string, string]> = {
      none: ['Sin estado', 'neutral'],
      normal: ['Sin cambios', 'neutral'],
      unversioned: ['Sin versionar', 'warning'],
      added: ['Agregado', 'success'],
      modified: ['Modificado', 'warning'],
      deleted: ['Eliminado', 'danger'],
      missing: ['Faltante', 'danger'],
      replaced: ['Reemplazado', 'warning'],
      conflicted: ['En conflicto', 'danger'],
      ignored: ['Ignorado', 'neutral'],
      incomplete: ['Incompleto', 'danger'],
      external: ['Externo', 'neutral'],
      obstructed: ['Obstruido', 'danger'],
      merged: ['Fusionado', 'success'],
    };
    Object.entries(expected).forEach(([item, [label, tone]]) =>
      expect(itemLabel(item)).toEqual({ label, tone }),
    );
  });

  it('shows unknown items as they come, neutral', () => {
    expect(itemLabel('frobnicated')).toEqual({
      label: 'frobnicated',
      tone: 'neutral',
    });
  });
});

describe('errorGuidance', () => {
  it('guides the kinds that need a user decision', () => {
    expect(errorGuidance('untrusted_certificate')).toContain('otro cliente');
    expect(errorGuidance('working_copy_too_old')).toContain('svn upgrade');
    expect(errorGuidance('working_copy_locked')).toContain('Cleanup');
  });

  it('has no guidance for generic kinds', () => {
    expect(errorGuidance('io')).toBeNull();
  });
});

describe('formatProgressLine', () => {
  it('formats items, revisions and plain text', () => {
    expect(
      formatProgressLine({
        kind: 'item',
        data: { action: 'added', path: 'a.txt' },
      }),
    ).toBe('Agregado a.txt');
    expect(
      formatProgressLine({ kind: 'revision', data: { revision: 5 } }),
    ).toBe('Revisión 5');
    expect(formatProgressLine({ kind: 'other', data: 'Updating' })).toBe(
      'Updating',
    );
  });

  it('falls back to the raw action when it has no translation', () => {
    expect(
      formatProgressLine({
        kind: 'item',
        data: { action: 'other', path: 'x' },
      }),
    ).toBe('other x');
  });
});

describe('formatDate', () => {
  it('formats a valid ISO date in Spanish', () => {
    expect(formatDate('2026-01-15T10:30:00.000000Z')).toMatch(/2026/);
  });

  it('returns the original text when it is not a date', () => {
    expect(formatDate('no-es-fecha')).toBe('no-es-fecha');
  });
});
