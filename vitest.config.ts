import vue from '@vitejs/plugin-vue';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['src/views/**/*.test.ts', 'happy-dom'],
      ['src/composables/{useFocusTrap,useModalIsolation}.test.ts', 'happy-dom'],
    ],
    exclude: [...configDefaults.exclude, '.stryker-tmp/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,ts}'],
    },
  },
});
