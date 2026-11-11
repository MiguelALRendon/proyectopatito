export const ROOT_FOLDER_LABEL = 'Mis archivos';

const SEPARATOR = '\\';
const SEPARATORS = /[\\/]/;
const ONEDRIVE_FOLDER = /\\onedrive(?: - [^\\]+)?(?=\\|$)/i;
const REPOSITORY_ROOT_PREFIX = /^\^\/?/;
const TRUNK = 'trunk';
const NAMED_LINES: readonly string[] = ['branches', 'tags'];

export interface Crumb {
  label: string;
  path: string;
}

export function pathSegments(path: string): string[] {
  return path.split(SEPARATORS).filter(Boolean);
}

export function fileNameOf(path: string): string {
  return pathSegments(path).pop() ?? path;
}

export function joinPath(directory: string, name: string): string {
  return [...pathSegments(directory), name].join(SEPARATOR);
}

export function parentPath(path: string): string {
  return pathSegments(path).slice(0, -1).join(SEPARATOR);
}

export function normalizedPath(path: string): string {
  return pathSegments(path).join(SEPARATOR);
}

export function pathKey(path: string): string {
  return normalizedPath(path).toLowerCase();
}

export function isSamePath(first: string, second: string): boolean {
  return pathKey(first) === pathKey(second);
}

export function breadcrumbs(path: string): Crumb[] {
  const segments = pathSegments(path);
  return segments.map((label, index) => ({
    label,
    path: segments.slice(0, index + 1).join(SEPARATOR),
  }));
}

export function isUnderOneDrive(absolutePath: string): boolean {
  return ONEDRIVE_FOLDER.test(absolutePath);
}

export function branchLabel(relativeUrl: string | null): string | null {
  if (!relativeUrl) return null;
  const [first, second] = pathSegments(
    relativeUrl.replace(REPOSITORY_ROOT_PREFIX, ''),
  );
  if (first === TRUNK) return `^/${TRUNK}`;
  if (NAMED_LINES.includes(first) && second) return `^/${first}/${second}`;
  return relativeUrl;
}
