import { defineConfig, mergeConfig } from 'vite';
import baseConfig from './vite.config';

const mock = (name: string) => `/tests/e2e/mock-tauri/${name}.ts`;

export default defineConfig(async (env) =>
  mergeConfig(await baseConfig(env), {
    server: { port: 1430 },
    resolve: {
      alias: {
        '@tauri-apps/api/core': mock('core'),
        '@tauri-apps/api/event': mock('event'),
        '@tauri-apps/plugin-dialog': mock('dialog'),
      },
    },
  }),
);
