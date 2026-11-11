import { ref, watch, type Ref } from 'vue';

export function usePersistedPreference<T>(
  key: string,
  defaultValue: T,
  validate: (raw: string) => T | null,
): Ref<T> {
  function read(): T {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      const parsed = validate(raw);
      return parsed === null ? defaultValue : parsed;
    } catch {
      return defaultValue;
    }
  }

  const value = ref(read()) as Ref<T>;

  watch(
    value,
    (next) => {
      try {
        localStorage.setItem(key, String(next));
      } catch {
        return;
      }
    },
    { flush: 'sync' },
  );

  return value;
}
