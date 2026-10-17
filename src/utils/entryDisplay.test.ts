import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../services/filesApi';
import {
  entrySizeLabel,
  entryTypeLabel,
  formatModified,
  formatSize,
} from './entryDisplay';

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

describe('sizes', () => {
  it('shows bytes without decimals and scales by 1024', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(1536)).toBe('1,5 KB');
    expect(formatSize(6 * 1024 * 1024)).toBe('6 MB');
  });

  it('stops at the largest unit instead of inventing one', () => {
    expect(formatSize(5 * 1024 ** 5)).toBe('5120 TB');
  });

  it('shows no size for folders', () => {
    expect(entrySizeLabel(entry('c', { kind: 'dir', size: 0 }))).toBe('-');
    expect(entrySizeLabel(entry('a', { size: 2048 }))).toBe('2 KB');
  });
});

describe('dates and types', () => {
  it('shows a dash when the date is unknown', () => {
    expect(formatModified(null)).toBe('-');
  });

  it('formats a known date as a readable string', () => {
    expect(formatModified(Date.UTC(2026, 0, 15, 12, 0))).toMatch(/2026/);
  });

  it('labels folders, files with and without extension', () => {
    expect(entryTypeLabel(entry('c', { kind: 'dir' }))).toBe('Carpeta');
    expect(entryTypeLabel(entry('a.txt'))).toBe('Archivo TXT');
    expect(entryTypeLabel(entry('LEEME'))).toBe('Archivo');
    expect(entryTypeLabel(entry('.gitignore'))).toBe('Archivo');
  });
});
