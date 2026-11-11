import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { UserConfig } from 'vite';
import viteConfig from '../../vite.config';

const REQUIRED_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const tauriHeaders = (
  JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
    app: { security: { headers?: Record<string, string> } };
  }
).app.security.headers;

const vite = (viteConfig as unknown as () => UserConfig)();

describe('aislamiento de origen cruzado', () => {
  it('el ejecutable lo exige con COOP y COEP exactos', () => {
    expect(tauriHeaders).toEqual(REQUIRED_HEADERS);
  });

  it('tauri dev lo exige igual que el ejecutable', () => {
    expect(vite.server?.headers).toEqual(tauriHeaders);
  });

  it('vite preview lo exige igual que el ejecutable', () => {
    expect(vite.preview?.headers).toEqual(tauriHeaders);
  });
});
