import { effectScope, type EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/filesApi', () => ({ fsReadChunk: vi.fn() }));

import { fsReadChunk } from '../services/filesApi';
import { HEX_CHUNK } from './limits';
import {
  MAX_CACHED_CHUNKS,
  useHexChunks,
  type HexChunks,
} from './useHexChunks';

const PATH = 'a\\datos.bin';
const FIRST_BYTE = 7;

let scope: EffectScope;

function chunkOf(fill: number): ArrayBuffer {
  return new Uint8Array(HEX_CHUNK).fill(fill).buffer;
}

function create(): HexChunks {
  return scope.run(() => useHexChunks(PATH)) as HexChunks;
}

async function settle() {
  await new Promise((done) => setTimeout(done, 0));
}

beforeEach(() => {
  scope = effectScope();
  vi.mocked(fsReadChunk).mockReset();
  vi.mocked(fsReadChunk).mockImplementation(async (_path, offset) =>
    chunkOf((offset / HEX_CHUNK + FIRST_BYTE) % 256),
  );
});

afterEach(() => scope.stop());

describe('useHexChunks', () => {
  it('no repite la petición de un tramo que ya está en vuelo', async () => {
    const chunks = create();
    chunks.ensure([0]);
    chunks.ensure([0]);
    await settle();
    expect(fsReadChunk).toHaveBeenCalledTimes(1);
    expect(fsReadChunk).toHaveBeenCalledWith(PATH, 0, HEX_CHUNK);
  });

  it('no vuelve a pedir un tramo en caché', async () => {
    const chunks = create();
    chunks.ensure([2]);
    await settle();
    chunks.ensure([2]);
    await settle();
    expect(fsReadChunk).toHaveBeenCalledTimes(1);
    expect(chunks.byteAt(2 * HEX_CHUNK + 5)).toBe(2 + FIRST_BYTE);
  });

  it('devuelve undefined mientras el tramo no ha llegado', () => {
    expect(create().byteAt(0)).toBeUndefined();
  });

  it('descarta el tramo más antiguo que ya no se pide al superar el máximo en caché', async () => {
    const chunks = create();
    for (let index = 0; index <= MAX_CACHED_CHUNKS; index += 1) {
      chunks.ensure([index]);
      await settle();
    }
    expect(chunks.byteAt(0)).toBeUndefined();
    expect(chunks.byteAt(MAX_CACHED_CHUNKS * HEX_CHUNK)).toBeDefined();
  });

  it('no descarta un tramo que sigue visible aunque sea el más antiguo', async () => {
    const chunks = create();
    for (let index = 0; index < MAX_CACHED_CHUNKS; index += 1) {
      chunks.ensure([index]);
      await settle();
    }
    chunks.ensure([0, MAX_CACHED_CHUNKS]);
    await settle();
    expect(chunks.byteAt(0)).toBeDefined();
    expect(chunks.byteAt(HEX_CHUNK)).toBeUndefined();
    expect(chunks.byteAt(MAX_CACHED_CHUNKS * HEX_CHUNK)).toBeDefined();
  });

  it('un error detiene nuevas peticiones hasta reintentar', async () => {
    vi.mocked(fsReadChunk).mockRejectedValueOnce({
      kind: 'io',
      message: 'disco',
      codes: [],
      detail: null,
    });
    const chunks = create();
    chunks.ensure([0]);
    await settle();
    expect(chunks.error.value?.message).toBe('disco');

    chunks.ensure([1]);
    await settle();
    expect(fsReadChunk).toHaveBeenCalledTimes(1);

    chunks.retry();
    await settle();
    expect(chunks.error.value).toBeNull();
    expect(fsReadChunk).toHaveBeenLastCalledWith(PATH, HEX_CHUNK, HEX_CHUNK);
    expect(chunks.byteAt(HEX_CHUNK)).toBe(1 + FIRST_BYTE);
  });

  it('reintentar sin que la ventana cambie vuelve a pedir el tramo que falló', async () => {
    vi.mocked(fsReadChunk).mockRejectedValueOnce(new Error('disco'));
    const chunks = create();
    chunks.ensure([0]);
    await settle();

    chunks.retry();
    await settle();
    expect(chunks.byteAt(0)).toBe(FIRST_BYTE);
  });

  it('un error que no es de comando se normaliza', async () => {
    vi.mocked(fsReadChunk).mockRejectedValueOnce(new Error('roto'));
    const chunks = create();
    chunks.ensure([0]);
    await settle();
    expect(chunks.error.value?.kind).toBe('io');
    expect(chunks.error.value?.message).toBe('roto');
  });

  it('ignora las respuestas que llegan después de destruir el ámbito', async () => {
    let finish: (buffer: ArrayBuffer) => void = () => undefined;
    vi.mocked(fsReadChunk).mockReturnValueOnce(
      new Promise<ArrayBuffer>((done) => (finish = done)),
    );
    const chunks = create();
    chunks.ensure([0]);
    const before = chunks.revision.value;
    scope.stop();
    finish(chunkOf(9));
    await settle();
    expect(chunks.byteAt(0)).toBeUndefined();
    expect(chunks.revision.value).toBe(before);
  });

  it('avisa con la revisión cada vez que llega un tramo', async () => {
    const chunks = create();
    const before = chunks.revision.value;
    chunks.ensure([0]);
    await settle();
    expect(chunks.revision.value).toBeGreaterThan(before);
  });
});
