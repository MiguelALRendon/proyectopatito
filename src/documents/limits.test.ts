import { describe, expect, it } from 'vitest';
import {
  MAX_RESPONSE_BYTES,
  PDF_MAX_IMAGE_PIXELS,
  PDF_RANGE_CHUNK_BYTES,
} from './limits';
import { isVectorImage } from './imageFormats';
import { MAX_CANVAS_PIXELS } from './pdfView';

const MIB = 1024 * 1024;

describe('límites de lectura de PDF', () => {
  it('el tope de respuesta del protocolo es de 32 MiB, como en Rust', () => {
    expect(MAX_RESPONSE_BYTES).toBe(32 * MIB);
  });

  it('cada rango que pide pdf.js cabe en una respuesta del protocolo', () => {
    expect(PDF_RANGE_CHUNK_BYTES).toBeGreaterThan(0);
    expect(PDF_RANGE_CHUNK_BYTES).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
  });

  it('el rango que pide pdf.js es de exactamente 4 MiB', () => {
    expect(PDF_RANGE_CHUNK_BYTES).toBe(4 * MIB);
  });

  it('el tamaño máximo de imagen es de exactamente 4096 x 4096 píxeles', () => {
    expect(PDF_MAX_IMAGE_PIXELS).toBe(16_777_216);
  });

  it('una imagen del PDF nunca supera el lienzo de una página', () => {
    expect(PDF_MAX_IMAGE_PIXELS).toBeLessThan(MAX_CANVAS_PIXELS);
    expect(MAX_CANVAS_PIXELS).toBe(36_000_000);
  });
});

describe('isVectorImage', () => {
  const probe = (mime: string, extension: string | null) => ({
    kind: 'image' as const,
    mime,
    len: 1,
    extension,
    has_macros: false,
    version: null,
  });

  it('un PNG no es vectorial', () => {
    expect(isVectorImage(probe('image/png', 'png'))).toBe(false);
  });

  it('reconoce el SVG por MIME o por extensión', () => {
    expect(isVectorImage(probe('image/svg+xml', null))).toBe(true);
    expect(isVectorImage(probe('application/octet-stream', 'svg'))).toBe(true);
  });
});
