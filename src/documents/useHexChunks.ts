import { onScopeDispose, ref, shallowRef, type Ref } from 'vue';
import { fsReadChunk } from '../services/filesApi';
import { normalizeError, type CommandError } from '../services/tauri';
import { HEX_CHUNK } from './limits';

export const MAX_CACHED_CHUNKS = 8;

export interface HexChunks {
  revision: Ref<number>;
  error: Ref<CommandError | null>;
  byteAt: (offset: number) => number | undefined;
  ensure: (indexes: number[]) => void;
  retry: () => void;
}

export function useHexChunks(path: string): HexChunks {
  const cache = new Map<number, Uint8Array>();
  const loading = new Set<number>();
  const revision = ref(0);
  const error = shallowRef<CommandError | null>(null);
  let wanted: number[] = [];
  let isDisposed = false;

  function remember(index: number, bytes: Uint8Array) {
    cache.set(index, bytes);
    while (cache.size > MAX_CACHED_CHUNKS) {
      const stale = [...cache.keys()].find((key) => !wanted.includes(key));
      if (stale === undefined) return;
      cache.delete(stale);
    }
  }

  async function load(index: number) {
    loading.add(index);
    try {
      const buffer = await fsReadChunk(path, index * HEX_CHUNK, HEX_CHUNK);
      if (!isDisposed) remember(index, new Uint8Array(buffer));
    } catch (failure) {
      if (!isDisposed) error.value = normalizeError(failure);
    } finally {
      loading.delete(index);
      if (!isDisposed) revision.value += 1;
    }
  }

  function ensure(indexes: number[]) {
    wanted = indexes;
    if (error.value) return;
    for (const index of indexes) {
      if (!cache.has(index) && !loading.has(index)) void load(index);
    }
  }

  function retry() {
    error.value = null;
    revision.value += 1;
    ensure(wanted);
  }

  const byteAt = (offset: number) =>
    cache.get(Math.floor(offset / HEX_CHUNK))?.[offset % HEX_CHUNK];

  onScopeDispose(() => {
    isDisposed = true;
    cache.clear();
  });

  return { revision, error, byteAt, ensure, retry };
}
