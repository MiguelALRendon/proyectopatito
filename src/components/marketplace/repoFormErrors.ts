import type { CommandError } from '../../services/tauri';

export type RepoField = 'name' | 'url' | 'username' | 'form';

const FIELD_HINTS: readonly (readonly [string, RepoField])[] = [
  ['usuario', 'username'],
  ['url', 'url'],
  ['nombre', 'name'],
];

export function fieldOfSaveError(error: CommandError): RepoField {
  const message = error.message.toLowerCase();
  const hint = FIELD_HINTS.find(([word]) => message.includes(word));
  return hint ? hint[1] : 'form';
}
