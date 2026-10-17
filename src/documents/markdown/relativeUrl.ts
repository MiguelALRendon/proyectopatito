import { fileUrl } from '../../services/filesApi';
import { pathSegments } from '../../utils/folderPaths';

export type ImageSource =
  | { kind: 'workspace'; url: string }
  | { kind: 'blocked'; reason: BlockedReason };

export type BlockedReason = 'remote' | 'unsafe';

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const PROTOCOL_RELATIVE = /^[\\/]/;
const EDGE_CONTROL_OR_SPACE = /^[\u0000- ]+|[\u0000- ]+$/g;
const LINE_BREAKS_AND_TABS = /[\t\n\r]/g;
const QUERY_OR_FRAGMENT = /[?#][\s\S]*$/;
const PERCENT_RUN = /(?:%[0-9a-f]{2})+/gi;
const SEPARATORS = /[\\/]/;
const UNUSABLE_SEGMENT = /[\u0000-\u001f:*?"<>|]/;
const PARENT = '..';
const CURRENT = '.';
const URL_SEPARATOR = '/';

function cleanReference(reference: string): string {
  return reference
    .replace(EDGE_CONTROL_OR_SPACE, '')
    .replace(LINE_BREAKS_AND_TABS, '');
}

function decodeRuns(text: string): string {
  return text.replace(PERCENT_RUN, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

function climb(base: string[], relative: string[]): string[] | null {
  const stack = [...base];
  for (const segment of relative) {
    if (segment === '' || segment === CURRENT) continue;
    if (UNUSABLE_SEGMENT.test(segment)) return null;
    if (segment !== PARENT) stack.push(segment);
    else if (stack.pop() === undefined) return null;
  }
  return stack.length > 0 ? stack : null;
}

export function resolveRelative(
  reference: string,
  baseDirectory: string,
): string | null {
  const cleaned = cleanReference(reference);
  if (cleaned === '' || SCHEME.test(cleaned)) return null;
  if (PROTOCOL_RELATIVE.test(cleaned)) return null;
  const path = decodeRuns(cleaned.replace(QUERY_OR_FRAGMENT, ''));
  const segments = climb(pathSegments(baseDirectory), path.split(SEPARATORS));
  return segments ? segments.join(URL_SEPARATOR) : null;
}

export function classifyImage(
  reference: string,
  baseDirectory: string,
): ImageSource {
  const cleaned = cleanReference(reference);
  if (SCHEME.test(cleaned) || PROTOCOL_RELATIVE.test(cleaned)) {
    return { kind: 'blocked', reason: 'remote' };
  }
  const path = resolveRelative(cleaned, baseDirectory);
  if (path === null) return { kind: 'blocked', reason: 'unsafe' };
  return { kind: 'workspace', url: fileUrl(path) };
}
