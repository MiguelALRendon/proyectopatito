import { describe, expect, it } from 'vitest';

const TAURI_IMPORT = /@tauri-apps\/|__TAURI|\binvoke\s*\(/;

const gateway = import.meta.glob('/src/services/tauri.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const rest = import.meta.glob(
  ['/src/**/*.{ts,vue}', '!/src/**/*.test.ts', '!/src/services/tauri.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

describe('frontend boundary', () => {
  it('detects the native API import in the gateway itself', () => {
    expect(TAURI_IMPORT.test(gateway['/src/services/tauri.ts'])).toBe(true);
  });

  it('keeps every other source file free of @tauri-apps imports', () => {
    const offenders = Object.entries(rest)
      .filter(([, code]) => TAURI_IMPORT.test(code))
      .map(([path]) => path);
    expect(Object.keys(rest).length).toBeGreaterThan(10);
    expect(Object.keys(rest)).toContain('/src/services/filesApi.ts');
    expect(offenders).toEqual([]);
  });
});
