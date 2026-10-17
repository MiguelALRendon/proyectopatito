import { describe, expect, it } from 'vitest';
import type { StatusEntry } from '../services/tauri';
import {
  STATE_LEGEND,
  entryStates,
  errorGuidance,
  formatProgressLine,
  isValidFolderName,
  formatDate,
  itemLabel,
} from './svnLabels';

const PLAIN_ENTRY: StatusEntry = {
  path: 'wc/a.txt',
  item: 'normal',
  props: 'none',
  revision: 1,
  remote_item: null,
  remote_props: null,
  wc_locked: false,
  tree_conflicted: false,
  copied: false,
  switched: false,
  lock: null,
};

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
      obstructed: ['Tipo cambiado', 'danger'],
      merged: ['Fusionado', 'success'],
      tree_conflicted: ['Conflicto de árbol', 'danger'],
      locked: ['Bloqueado', 'warning'],
      wc_locked: ['Requiere limpieza', 'danger'],
      copied: ['Copiado', 'neutral'],
      switched: ['Cambiado de rama', 'neutral'],
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

describe('STATE_LEGEND', () => {
  it('lists every state a badge can show, once, without the empty one', () => {
    const keys = STATE_LEGEND.map((state) => state.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain('none');
    expect(keys).toEqual(
      expect.arrayContaining([
        'modified',
        'locked',
        'tree_conflicted',
        'copied',
        'switched',
        'obstructed',
      ]),
    );
  });

  it('takes label and tone from the same table as the badges', () => {
    STATE_LEGEND.forEach(({ key, label, tone }) =>
      expect(itemLabel(key)).toEqual({ label, tone }),
    );
  });
});

describe('entryStates', () => {
  it('shows nothing for an entry without changes', () => {
    expect(entryStates(PLAIN_ENTRY)).toEqual([]);
  });

  it('shows the item and a property change once each', () => {
    const changed = { ...PLAIN_ENTRY, item: 'modified', props: 'modified' };
    expect(entryStates(changed)).toEqual(['modified']);
    const onlyProps = { ...PLAIN_ENTRY, props: 'modified' };
    expect(entryStates(onlyProps)).toEqual(['modified']);
  });

  it('adds one state per svn flag, whatever the item', () => {
    const flagged: StatusEntry = {
      ...PLAIN_ENTRY,
      item: 'added',
      tree_conflicted: true,
      wc_locked: true,
      copied: true,
      switched: true,
      lock: { owner: 'alice', comment: null },
    };
    expect(entryStates(flagged)).toEqual([
      'added',
      'tree_conflicted',
      'wc_locked',
      'copied',
      'switched',
      'locked',
    ]);
  });

  it('marks a locked file that is otherwise unchanged', () => {
    const locked = { ...PLAIN_ENTRY, lock: { owner: 'a', comment: 'x' } };
    expect(entryStates(locked)).toEqual(['locked']);
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
