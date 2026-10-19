export interface OfficeCapabilities {
  crossOriginIsolated: boolean;
  hasSharedArrayBuffer: boolean;
  hasWebAssembly: boolean;
}

export function currentCapabilities(): OfficeCapabilities {
  return {
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    hasWebAssembly: typeof WebAssembly !== 'undefined',
  };
}

export function isOfficeSupported(
  capabilities: OfficeCapabilities = currentCapabilities(),
): boolean {
  return (
    capabilities.crossOriginIsolated &&
    capabilities.hasSharedArrayBuffer &&
    capabilities.hasWebAssembly
  );
}
