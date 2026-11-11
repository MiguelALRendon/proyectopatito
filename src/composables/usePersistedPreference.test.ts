import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePersistedPreference } from './usePersistedPreference';

const store = new Map<string, string>();
const getItem = vi.fn((key: string) => store.get(key) ?? null);
const setItem = vi.fn((key: string, value: string) => {
  store.set(key, value);
});

const asNumber = (raw: string) => {
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
};

beforeEach(() => {
  store.clear();
  getItem.mockClear();
  setItem.mockClear();
  vi.stubGlobal('localStorage', { getItem, setItem });
});

afterEach(() => vi.unstubAllGlobals());

describe('usePersistedPreference', () => {
  it('returns the default when nothing is stored', () => {
    expect(usePersistedPreference('k', 7, asNumber).value).toBe(7);
  });

  it('returns the default when the stored text fails validation', () => {
    store.set('k', 'no-es-numero');
    expect(usePersistedPreference('k', 7, asNumber).value).toBe(7);
  });

  it('survives a storage that throws on read', () => {
    getItem.mockImplementationOnce(() => {
      throw new Error('bloqueado');
    });
    expect(usePersistedPreference('k', 7, asNumber).value).toBe(7);
  });

  it('survives a storage that throws on write and keeps the in-memory value', () => {
    setItem.mockImplementationOnce(() => {
      throw new Error('lleno');
    });
    const preference = usePersistedPreference('k', 1, asNumber);
    preference.value = 2;
    expect(preference.value).toBe(2);
  });

  it('writes every change synchronously', () => {
    const preference = usePersistedPreference('k', 1, asNumber);
    preference.value = 5;
    expect(setItem).toHaveBeenLastCalledWith('k', '5');
  });

  it('restores a previously stored valid value', () => {
    store.set('k', '42');
    expect(usePersistedPreference('k', 7, asNumber).value).toBe(42);
  });
});
