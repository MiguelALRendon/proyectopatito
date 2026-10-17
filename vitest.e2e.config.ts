import { defineConfig } from 'vitest/config';

const E2E_TIMEOUT_MS = 120_000;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/real-app/**/*.e2e.ts'],
    testTimeout: E2E_TIMEOUT_MS,
    hookTimeout: E2E_TIMEOUT_MS,
    fileParallelism: false,
  },
});
