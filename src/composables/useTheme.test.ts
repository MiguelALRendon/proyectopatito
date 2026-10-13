import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const setAttribute = vi.fn();
const removeAttribute = vi.fn();
let systemPrefersDark = false;

async function loadTheme() {
  vi.resetModules();
  return import('./useTheme');
}

beforeEach(() => {
  store.clear();
  setAttribute.mockClear();
  removeAttribute.mockClear();
  systemPrefersDark = false;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  vi.stubGlobal('document', {
    createElement: () => ({}),
    documentElement: { setAttribute, removeAttribute },
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: systemPrefersDark }),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('useTheme', () => {
  it('ignores an invalid stored value and follows the system', async () => {
    store.set('dakedaduck-theme', 'rosa');
    systemPrefersDark = true;
    const { useTheme } = await loadTheme();
    expect(useTheme().resolvedTheme.value).toBe('dark');
    expect(removeAttribute).toHaveBeenCalledWith('data-theme');
  });

  it('follows the system light preference when nothing is stored', async () => {
    const { useTheme } = await loadTheme();
    expect(useTheme().resolvedTheme.value).toBe('light');
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it('applies the stored theme on load, over the system preference', async () => {
    store.set('dakedaduck-theme', 'dark');
    systemPrefersDark = false;
    const { useTheme } = await loadTheme();
    expect(useTheme().resolvedTheme.value).toBe('dark');
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
  });

  it('toggles from the resolved theme, persists it and applies it', async () => {
    systemPrefersDark = true;
    const { useTheme, THEME_STORAGE_KEY } = await loadTheme();
    const { resolvedTheme, toggleTheme } = useTheme();
    toggleTheme();
    expect(resolvedTheme.value).toBe('light');
    expect(store.get(THEME_STORAGE_KEY)).toBe('light');
    expect(setAttribute).toHaveBeenLastCalledWith('data-theme', 'light');
    toggleTheme();
    expect(resolvedTheme.value).toBe('dark');
  });
});
