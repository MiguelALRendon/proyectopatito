import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
const TYPESCRIPT_FEATURES =
  /^(?:\.\/|.*\/languages\/)features\/typescript\/register\.js$/;
const NO_TYPESCRIPT_FEATURES = fileURLToPath(
  new URL('./src/documents/monaco/noTypescriptFeatures.ts', import.meta.url),
);
const PDFJS_ASSETS = /node_modules[\/]pdfjs-dist[\/]/;
const PDFJS_ASSET_FILES = 'assets/pdfjs/[name][extname]';
const DEFAULT_ASSET_FILES = 'assets/[name]-[hash][extname]';
const host = process.env.TAURI_DEV_HOST;
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
const isPdfjsAsset = (names: readonly string[] | undefined) =>
  (names ?? []).some((name) => PDFJS_ASSETS.test(name));
export default defineConfig(() => ({
  plugins: [vue()],
  resolve: {
    alias: [{ find: TYPESCRIPT_FEATURES, replacement: NO_TYPESCRIPT_FEATURES }],
  },
  build: {
    assetsInlineLimit: (filePath: string) =>
      PDFJS_ASSETS.test(filePath) ? false : undefined,
    rollupOptions: {
      output: {
        assetFileNames: (asset: { originalFileNames?: string[] }) =>
          isPdfjsAsset(asset.originalFileNames)
            ? PDFJS_ASSET_FILES
            : DEFAULT_ASSET_FILES,
      },
    },
  },
  clearScreen: false,
  preview: { headers: ISOLATION_HEADERS },
  server: {
    headers: ISOLATION_HEADERS,
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
}));
