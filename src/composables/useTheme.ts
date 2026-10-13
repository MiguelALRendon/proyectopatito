import { computed, watch, type ComputedRef } from 'vue';
import { usePersistedPreference } from './usePersistedPreference';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'dakedaduck-theme';

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(value: Theme | null) {
  if (value === null) {
    document.documentElement.removeAttribute('data-theme');
    return;
  }
  document.documentElement.setAttribute('data-theme', value);
}

function validateTheme(raw: string): Theme | null {
  return raw === 'light' || raw === 'dark' ? raw : null;
}

const storedTheme = usePersistedPreference<Theme | null>(
  THEME_STORAGE_KEY,
  null,
  validateTheme,
);
applyTheme(storedTheme.value);
watch(storedTheme, applyTheme, { flush: 'sync' });

export interface ThemeHandle {
  resolvedTheme: ComputedRef<Theme>;
  toggleTheme: () => void;
}

export function useTheme(): ThemeHandle {
  const resolvedTheme = computed<Theme>(
    () => storedTheme.value ?? systemTheme(),
  );

  function toggleTheme() {
    const next: Theme = resolvedTheme.value === 'dark' ? 'light' : 'dark';
    storedTheme.value = next;
  }

  return { resolvedTheme, toggleTheme };
}
