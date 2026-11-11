import { effectScope, watch } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const setAttribute = vi.fn();
const removeAttribute = vi.fn();
let systemPrefersDark = false;
const changeListeners = new Set<(event: MediaQueryListEvent) => void>();

function emitSystemChange(prefersDark: boolean) {
  systemPrefersDark = prefersDark;
  changeListeners.forEach((listener) =>
    listener({ matches: prefersDark } as MediaQueryListEvent),
  );
}

async function loadTheme() {
  vi.resetModules();
  return import('./useTheme');
}

beforeEach(() => {
  store.clear();
  setAttribute.mockClear();
  removeAttribute.mockClear();
  systemPrefersDark = false;
  changeListeners.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  vi.stubGlobal('document', {
    createElement: () => ({}),
    documentElement: { setAttribute, removeAttribute },
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({
      matches: systemPrefersDark,
      addEventListener: (_type: string, listener: never) =>
        changeListeners.add(listener),
      removeEventListener: (_type: string, listener: never) =>
        changeListeners.delete(listener),
    }),
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

  it('follows a system theme change while nothing is stored', async () => {
    const { useTheme } = await loadTheme();
    const { resolvedTheme } = useTheme();
    expect(resolvedTheme.value).toBe('light');
    emitSystemChange(true);
    expect(resolvedTheme.value).toBe('dark');
    emitSystemChange(false);
    expect(resolvedTheme.value).toBe('light');
  });

  it('notifies watchers when the system theme changes', async () => {
    const { useTheme } = await loadTheme();
    const { resolvedTheme } = useTheme();
    const seen: string[] = [];
    watch(resolvedTheme, (theme) => seen.push(theme), { flush: 'sync' });
    emitSystemChange(true);
    expect(seen).toEqual(['dark']);
  });

  it('ignores system changes once a theme is stored', async () => {
    store.set('dakedaduck-theme', 'light');
    const { useTheme } = await loadTheme();
    const { resolvedTheme } = useTheme();
    emitSystemChange(true);
    expect(resolvedTheme.value).toBe('light');
  });

  it('stops listening when its scope is disposed', async () => {
    const { useTheme } = await loadTheme();
    const scope = effectScope();
    const handle = scope.run(() => useTheme());
    expect(changeListeners.size).toBe(1);
    scope.stop();
    expect(changeListeners.size).toBe(0);
    emitSystemChange(true);
    expect(handle?.resolvedTheme.value).toBe('light');
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
