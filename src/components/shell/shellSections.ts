export const SHELL_SECTIONS = [
  { id: 'files', label: 'Mis archivos' },
  { id: 'marketplace', label: 'Marketplace' },
] as const;

export type ShellSection = (typeof SHELL_SECTIONS)[number]['id'];

export const DEFAULT_SECTION: ShellSection = 'files';
