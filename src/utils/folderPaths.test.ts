import { describe, expect, it } from 'vitest';
import {
  branchLabel,
  breadcrumbs,
  fileNameOf,
  isSamePath,
  isUnderOneDrive,
  joinPath,
  normalizedPath,
  parentPath,
  pathKey,
  pathSegments,
} from './folderPaths';

describe('path segments', () => {
  it('ignores empty segments and accepts both separators', () => {
    expect(pathSegments('\\a//b\\\\c/')).toEqual(['a', 'b', 'c']);
    expect(pathSegments('')).toEqual([]);
    expect(pathSegments('///')).toEqual([]);
  });

  it('joins onto the root without a leading separator', () => {
    expect(joinPath('', 'wc')).toBe('wc');
    expect(joinPath('a\\b', 'c d.txt')).toBe('a\\b\\c d.txt');
    expect(joinPath('a/b/', 'c')).toBe('a\\b\\c');
  });

  it('has no parent above the workspace root', () => {
    expect(parentPath('')).toBe('');
    expect(parentPath('a')).toBe('');
    expect(parentPath('a\\b\\c')).toBe('a\\b');
  });

  it('compares paths ignoring case and separator style', () => {
    expect(isSamePath('Docs\\Sub', 'docs/sub/')).toBe(true);
    expect(isSamePath('', '\\')).toBe(true);
    expect(isSamePath('a', 'ab')).toBe(false);
  });
});

describe('breadcrumbs', () => {
  it('has no crumbs at the root', () => {
    expect(breadcrumbs('')).toEqual([]);
  });

  it('accumulates the path of each crumb', () => {
    expect(breadcrumbs('a\\b\\c')).toEqual([
      { label: 'a', path: 'a' },
      { label: 'b', path: 'a\\b' },
      { label: 'c', path: 'a\\b\\c' },
    ]);
  });
});

describe('OneDrive detection', () => {
  it('detects a folder named OneDrive or OneDrive - Name, ignoring case', () => {
    expect(isUnderOneDrive('C:\\Users\\a\\OneDrive\\Escritorio\\wc')).toBe(
      true,
    );
    expect(isUnderOneDrive('C:\\Users\\a\\onedrive - Empresa\\wc')).toBe(true);
    expect(isUnderOneDrive('D:\\Nube\\OneDrive')).toBe(true);
  });

  it('does not flag folders that merely start with the name', () => {
    expect(isUnderOneDrive('C:\\Users\\a\\OneDriveBackup\\wc')).toBe(false);
    expect(isUnderOneDrive('C:\\OneDrive2\\wc')).toBe(false);
    expect(isUnderOneDrive('C:\\OneDrive - \\wc')).toBe(false);
  });

  it('does not flag a plain local path or one that only mentions OneDrive mid-name', () => {
    expect(isUnderOneDrive('C:\\trabajo\\wc')).toBe(false);
    expect(isUnderOneDrive('C:\\trabajo\\MiOneDrive\\wc')).toBe(false);
  });
});

describe('branch label', () => {
  it('has no branch when svn reports no relative url', () => {
    expect(branchLabel(null)).toBeNull();
    expect(branchLabel('')).toBeNull();
  });

  it('shows trunk, branches and tags as the standard layout', () => {
    expect(branchLabel('^/trunk')).toBe('^/trunk');
    expect(branchLabel('^/trunk/src/app')).toBe('^/trunk');
    expect(branchLabel('^/branches/feature-x')).toBe('^/branches/feature-x');
    expect(branchLabel('^/branches/feature-x/sub')).toBe(
      '^/branches/feature-x',
    );
    expect(branchLabel('^/tags/1.0')).toBe('^/tags/1.0');
  });

  it('shows the relative url as is for any other layout', () => {
    expect(branchLabel('^/')).toBe('^/');
    expect(branchLabel('^/proyecto/rama-unica')).toBe('^/proyecto/rama-unica');
    expect(branchLabel('^/branches')).toBe('^/branches');
  });
});

describe('path keys', () => {
  it('normalizes separators without changing the case', () => {
    expect(normalizedPath('\\a//B\\')).toBe('a\\B');
    expect(normalizedPath('')).toBe('');
  });

  it('ignores case and separators so the same folder always has one key', () => {
    expect(pathKey('Docs/Sub')).toBe(pathKey('docs\\SUB\\'));
    expect(pathKey('A\\B')).not.toBe(pathKey('A\\BC'));
    expect(pathKey('///')).toBe('');
  });
});

describe('file name', () => {
  it('returns the last segment of a mixed-separator path', () => {
    expect(fileNameOf('a\\b/c.txt')).toBe('c.txt');
  });

  it('falls back to the given path when there are no segments', () => {
    expect(fileNameOf('')).toBe('');
    expect(fileNameOf('///')).toBe('///');
  });
});
