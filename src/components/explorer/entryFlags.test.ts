import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../../services/filesApi';
import {
  CHANGES_BELOW_BADGE,
  NORMAL_BADGE,
  localBadge,
} from '../../utils/svnBadges';
import { entryAriaLabel, entryFlags } from './entryFlags';

function entry(name: string, extra: Partial<FileEntry> = {}): FileEntry {
  return {
    name,
    kind: 'file',
    size: 0,
    modified_ms: null,
    hidden: false,
    read_only: false,
    is_link: false,
    escapes_workspace: false,
    cloud_only: false,
    ...extra,
  };
}

describe('entry flags', () => {
  it('has no flag for a plain file or folder', () => {
    expect(entryFlags(entry('a.txt'))).toEqual([]);
    expect(entryFlags(entry('c', { kind: 'dir' }))).toEqual([]);
  });

  it('marks a cloud-only file with the cloud indicator', () => {
    expect(entryFlags(entry('a.bin', { cloud_only: true }))).toEqual([
      { icon: 'cloud', label: 'Solo en la nube' },
    ]);
  });

  it('shows a link inside the workspace as a link and one outside as a blocked warning', () => {
    const inside = entryFlags(entry('l', { is_link: true }));
    expect(inside.map((flag) => flag.icon)).toEqual(['link']);
    const outside = entry('l', { is_link: true, escapes_workspace: true });
    expect(entryFlags(outside).map((flag) => flag.icon)).toEqual(['warning']);
  });

  it('accumulates several flags in a stable order', () => {
    const flags = entryFlags(entry('a', { cloud_only: true, read_only: true }));
    expect(flags.map((flag) => flag.icon)).toEqual(['cloud', 'lock']);
  });
});

describe('entry aria label', () => {
  it('names the kind and the entry', () => {
    expect(entryAriaLabel(entry('a.txt'))).toBe('Archivo: a.txt');
    expect(entryAriaLabel(entry('docs', { kind: 'dir' }))).toBe(
      'Carpeta: docs',
    );
  });

  it('adds the flags so a screen reader hears them', () => {
    const label = entryAriaLabel(
      entry('a', { cloud_only: true, read_only: true }),
    );
    expect(label).toBe('Archivo: a, solo en la nube, solo lectura');
  });
});

describe('entry aria label with states', () => {
  it('adds each state after the flags', () => {
    const label = entryAriaLabel(entry('a', { read_only: true }), [
      localBadge('conflicted'),
      localBadge('modified'),
    ]);
    expect(label).toBe('Archivo: a, solo lectura, En conflicto, Modificado');
  });

  it('says nothing about a file without changes, as before', () => {
    expect(entryAriaLabel(entry('a'), [NORMAL_BADGE])).toBe('Archivo: a');
    expect(entryAriaLabel(entry('a'), [])).toBe('Archivo: a');
  });

  it('tells a folder that contains changes', () => {
    const folder = entry('src', { kind: 'dir' });
    expect(entryAriaLabel(folder, [CHANGES_BELOW_BADGE])).toBe(
      'Carpeta: src, Contiene cambios',
    );
  });
});
