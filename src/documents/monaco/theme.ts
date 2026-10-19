import * as monaco from 'monaco-editor';
import type { Theme } from '../../composables/useTheme';

const THEME_NAME_PREFIX = 'dakedaduck';
const THEME_BASES: Record<Theme, 'vs' | 'vs-dark'> = {
  light: 'vs',
  dark: 'vs-dark',
};
const SELECTION_ALPHA = '40';
const SELECTION_TOKEN = '--color-primary';
const THEME_TOKENS: Record<string, string> = {
  'editor.background': '--color-bg',
  'editor.foreground': '--color-text',
  'editorLineNumber.foreground': '--color-text-muted',
  'editorLineNumber.activeForeground': '--color-text',
  'editorGutter.background': '--color-bg-elevated',
  'editor.lineHighlightBackground': '--color-bg-elevated',
  'editorCursor.foreground': '--color-primary',
  'minimap.background': '--color-bg-elevated',
  'editorWidget.background': '--color-bg-elevated',
  'editorWidget.border': '--color-border',
  'input.background': '--color-bg',
  'input.border': '--color-border',
  focusBorder: '--color-primary',
};

export function readToken(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function expandHex(color: string): string {
  const isShort = /^#[0-9a-f]{3}$/i.test(color);
  if (!isShort) return color;
  return `#${[...color.slice(1)].map((digit) => digit + digit).join('')}`;
}

function themeColors(): Record<string, string> {
  const colorOf = (token: string) => expandHex(readToken(token));
  const colors = Object.fromEntries(
    Object.entries(THEME_TOKENS).map(([key, token]) => [key, colorOf(token)]),
  );
  colors['editor.selectionBackground'] =
    `${colorOf(SELECTION_TOKEN)}${SELECTION_ALPHA}`;
  return colors;
}

export function applyTheme(theme: Theme) {
  const name = `${THEME_NAME_PREFIX}-${theme}`;
  monaco.editor.defineTheme(name, {
    base: THEME_BASES[theme],
    inherit: true,
    rules: [],
    colors: themeColors(),
  });
  monaco.editor.setTheme(name);
}
