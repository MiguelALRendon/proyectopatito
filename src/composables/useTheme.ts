import {
  computed,
  getCurrentScope,
  onScopeDispose,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue';
import { usePersistedPreference } from './usePersistedPreference';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'dakedaduck-theme';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function themeOf(prefersDark: boolean): Theme {
  return prefersDark ? 'dark' : 'light';
}

function trackSystemTheme(): Ref<Theme> {
  const query = window.matchMedia(DARK_SCHEME_QUERY);
  const theme = ref<Theme>(themeOf(query.matches));
  const onChange = (event: MediaQueryListEvent) => {
    theme.value = themeOf(event.matches);
  };
  query.addEventListener('change', onChange);
  if (getCurrentScope()) {
    onScopeDispose(() => query.removeEventListener('change', onChange));
  }
  return theme;
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
  const systemTheme = trackSystemTheme();
  const resolvedTheme = computed<Theme>(
    () => storedTheme.value ?? systemTheme.value,
  );

  function toggleTheme() {
    const next: Theme = resolvedTheme.value === 'dark' ? 'light' : 'dark';
    storedTheme.value = next;
  }

  return { resolvedTheme, toggleTheme };
}
