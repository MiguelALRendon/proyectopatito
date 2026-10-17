import { describe, expect, it } from 'vitest';
import { isAllowedRequest, isProcessAlive } from './harness';

describe('isAllowedRequest', () => {
  it('rechaza hosts externos', () => {
    expect(isAllowedRequest('https://example.com/a.js', 'debug')).toBe(false);
    expect(isAllowedRequest('https://cdn.zetaoffice.net/x', 'release')).toBe(
      false,
    );
  });

  it('rechaza hosts que solo se parecen a los propios', () => {
    expect(isAllowedRequest('http://tauri.localhost.evil.com/', 'debug')).toBe(
      false,
    );
    expect(isAllowedRequest('http://evil.com/tauri.localhost', 'debug')).toBe(
      false,
    );
  });

  it('acepta localhost:1420 solo en modo dev', () => {
    expect(isAllowedRequest('http://localhost:1420/', 'dev')).toBe(true);
    expect(isAllowedRequest('http://localhost:1420/', 'debug')).toBe(false);
    expect(isAllowedRequest('http://localhost:1420/', 'release')).toBe(false);
  });

  it('acepta los hosts propios y los esquemas locales', () => {
    expect(isAllowedRequest('http://tauri.localhost/index.html', 'debug')).toBe(
      true,
    );
    expect(isAllowedRequest('http://ipc.localhost/cmd', 'release')).toBe(true);
    expect(
      isAllowedRequest('http://workspace-file.localhost/a.png', 'debug'),
    ).toBe(true);
    expect(isAllowedRequest('blob:http://tauri.localhost/1', 'debug')).toBe(
      true,
    );
    expect(isAllowedRequest('data:image/png;base64,AAAA', 'debug')).toBe(true);
  });
});

describe('isProcessAlive', () => {
  it('detecta el proceso actual y rechaza un pid inexistente', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2_000_000_000)).toBe(false);
  });
});
