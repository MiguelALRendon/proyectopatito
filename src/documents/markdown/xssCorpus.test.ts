import { describe, expect, it } from 'vitest';
import { XSS_CORPUS } from './xssCorpus';

const REQUIRED_FAMILIES: [string, RegExp][] = [
  ['script', /<script/i],
  ['manejador de eventos', /onerror=|onclick=|onload=|ontoggle=/i],
  ['javascript:', /javascript:/i],
  ['vbscript:', /vbscript:/i],
  ['data:', /\(data:|href="data:|data="data:/i],
  ['svg', /<svg/i],
  ['math', /<math/i],
  ['iframe', /<iframe/i],
  ['object y embed', /<object|<embed/i],
  ['style', /<style|style="/i],
  ['formularios', /<form|<input|formaction/i],
  ['data-*', /data-[a-z]+=/i],
  ['aria-*', /aria-[a-z]+=/i],
  ['srcset', /srcset=/i],
  ['comentario condicional', /<!--\[if/i],
  ['mXSS por anidamiento', /<noscript|<mglyph|<form><math/i],
  ['base y meta', /<base|<meta/i],
  ['imagen remota', /!\[[^\]]*\]\(https?:\/\//i],
  ['imagen que escapa del root', /\.\.\/\.\.\/\.\.\//],
];

describe('guardia de datos del corpus XSS (no ejecuta el saneador)', () => {
  it('no repite nombres ni cargas', () => {
    const names = XSS_CORPUS.map(({ name }) => name);
    const payloads = XSS_CORPUS.map(({ markdown }) => markdown);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(payloads).size).toBe(payloads.length);
  });

  it('cada carga tiene contenido', () => {
    expect(XSS_CORPUS.every(({ markdown }) => markdown.length > 0)).toBe(true);
  });

  it.each(REQUIRED_FAMILIES)('cubre la familia %s', (_name, pattern) => {
    expect(XSS_CORPUS.some(({ markdown }) => pattern.test(markdown))).toBe(
      true,
    );
  });
});
