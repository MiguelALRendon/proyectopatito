import { describe, expect, it } from 'vitest';
import rawConfig from '../../src-tauri/tauri.conf.json?raw';

type Policy = Record<string, string[]>;

const { csp, devCsp } = (
  JSON.parse(rawConfig) as {
    app: { security: { csp: string; devCsp: string } };
  }
).app.security;

function parsePolicy(text: string): Policy {
  const directives = text
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .filter(([name]) => name !== '');
  return Object.fromEntries(
    directives.map(([name, ...sources]) => [name, sources]),
  );
}

const WORKSPACE_FILE = 'http://workspace-file.localhost';
const DEV_ORIGINS = ['ws://localhost:1420', 'http://localhost:1420'];
const production = parsePolicy(csp);
const development = parsePolicy(devCsp);

describe('CSP de producción', () => {
  it.each([
    ['default-src', ["'self'"]],
    ['script-src', ["'self'"]],
    ['worker-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['font-src', ["'self'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', WORKSPACE_FILE]],
    ['connect-src', ['ipc:', 'http://ipc.localhost', WORKSPACE_FILE]],
  ])('%s es exactamente %j', (directive, sources) => {
    expect(production[directive]).toEqual(sources);
  });

  it('no declara ninguna directiva fuera de esta lista', () => {
    expect(Object.keys(production).sort()).toEqual([
      'base-uri',
      'connect-src',
      'default-src',
      'font-src',
      'frame-src',
      'img-src',
      'object-src',
      'script-src',
      'style-src',
      'worker-src',
    ]);
  });

  it('los scripts no admiten eval ni código en línea', () => {
    expect(production['script-src']).not.toContain("'unsafe-eval'");
    expect(production['script-src']).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/\*|https?:\/\/[^ ;]*\*/);
  });

  it('solo style-src admite estilos en línea', () => {
    const withInline = Object.entries(production)
      .filter(([, sources]) => sources.includes("'unsafe-inline'"))
      .map(([directive]) => directive);
    expect(withInline).toEqual(['style-src']);
  });

  it('ningún origen de desarrollo llega a producción', () => {
    expect(csp).not.toContain('localhost:1420');
  });
});

describe('CSP de desarrollo', () => {
  it('difiere de producción solo en los orígenes localhost:1420 de connect-src', () => {
    const { 'connect-src': devConnect, ...devRest } = development;
    const { 'connect-src': prodConnect, ...prodRest } = production;
    expect(devRest).toEqual(prodRest);
    expect(devConnect).toEqual([...prodConnect, ...DEV_ORIGINS]);
  });

  it('conserva el mismo orden de directivas', () => {
    expect(Object.keys(development)).toEqual(Object.keys(production));
  });
});
