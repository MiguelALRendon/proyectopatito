import { describe, expect, it } from 'vitest';
import {
  currentCapabilities,
  isOfficeSupported,
  type OfficeCapabilities,
} from './officeSupport';

const FULL: OfficeCapabilities = {
  crossOriginIsolated: true,
  hasSharedArrayBuffer: true,
  hasWebAssembly: true,
};

describe('isOfficeSupported', () => {
  it('acepta un WebView con aislamiento, memoria compartida y WebAssembly', () => {
    expect(isOfficeSupported(FULL)).toBe(true);
  });

  it.each(Object.keys(FULL) as (keyof OfficeCapabilities)[])(
    'rechaza si falta %s',
    (missing) => {
      expect(isOfficeSupported({ ...FULL, [missing]: false })).toBe(false);
    },
  );
});

describe('currentCapabilities', () => {
  it('lee el entorno real sin lanzar y con booleanos', () => {
    const capabilities = currentCapabilities();
    expect(Object.keys(capabilities).sort()).toEqual(Object.keys(FULL).sort());
    for (const value of Object.values(capabilities)) {
      expect(typeof value).toBe('boolean');
    }
    expect(capabilities.hasWebAssembly).toBe(true);
  });

  it('crossOriginIsolated solo es cierto cuando el entorno lo declara', () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      'crossOriginIsolated',
    );
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: 'sí',
      configurable: true,
    });
    expect(currentCapabilities().crossOriginIsolated).toBe(false);
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: true,
      configurable: true,
    });
    expect(currentCapabilities().crossOriginIsolated).toBe(true);
    if (original)
      Object.defineProperty(globalThis, 'crossOriginIsolated', original);
    else Reflect.deleteProperty(globalThis, 'crossOriginIsolated');
  });
});
