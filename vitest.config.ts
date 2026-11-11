import vue from '@vitejs/plugin-vue';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['src/App.test.ts', 'happy-dom'],
      ['src/views/**/*.test.ts', 'happy-dom'],
      [
        'src/composables/{useArchiveExtraction,useFocusTrap,useModalIsolation,useResizablePanel,useSelection,useWindowClose}.test.ts',
        'happy-dom',
      ],
      ['src/{components,documents}/**/*.test.ts', 'happy-dom'],
    ],
    exclude: [...configDefaults.exclude, '.stryker-tmp/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,ts}'],
    },
  },
});
