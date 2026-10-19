import { describe, expect, it } from 'vitest';
import {
  isAllowedRequest,
  isolationProblems,
  isPolicyBlock,
  isProcessAlive,
} from './harness';

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

  it('acepta el host de los recursos de ZetaOffice y no uno parecido', () => {
    expect(
      isAllowedRequest('http://zeta-assets.localhost/host.html', 'debug'),
    ).toBe(true);
    expect(
      isAllowedRequest('http://zeta-assets.localhost.evil.com/x', 'debug'),
    ).toBe(false);
  });
});

describe('isPolicyBlock', () => {
  it('reconoce el bloqueo por COEP o CORP', () => {
    expect(isPolicyBlock('net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin')).toBe(
      true,
    );
  });

  it('ignora otros fallos y la ausencia de texto', () => {
    expect(isPolicyBlock('net::ERR_ABORTED')).toBe(false);
    expect(isPolicyBlock('net::ERR_BLOCKED_BY_CSP')).toBe(false);
    expect(isPolicyBlock(undefined)).toBe(false);
  });
});

describe('isolationProblems', () => {
  const isolated = {
    crossOriginIsolated: true,
    sharedArrayBuffer: true,
    sharedMemory: true,
  };

  it('no reporta nada en una ventana aislada', () => {
    expect(isolationProblems(isolated)).toEqual([]);
  });

  it.each([
    ['crossOriginIsolated', 'crossOriginIsolated no es true'],
    ['sharedArrayBuffer', 'SharedArrayBuffer no existe'],
    ['sharedMemory', 'WebAssembly.Memory compartida no se pudo crear'],
  ])('reporta %s cuando falta', (key, problem) => {
    expect(isolationProblems({ ...isolated, [key]: false })).toEqual([problem]);
  });
});

describe('isProcessAlive', () => {
  it('detecta el proceso actual y rechaza un pid inexistente', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2_000_000_000)).toBe(false);
  });
});
