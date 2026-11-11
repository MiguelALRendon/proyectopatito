import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import process from 'node:process';
import { resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';

const MONACO_ENTRIES = [
  'monaco-editor/esm/vs/index.js',
  'monaco-editor/esm/vs/editor/editor.main.js',
  'monaco-editor/esm/vs/languages/register.all.js',
];
const FEATURE_IMPORT = /from '([^']*features\/typescript\/register\.js)'/;
const CONFIG_FILE = resolvePath(process.cwd(), 'vite.config.ts');
const EMPTY_MODULE = 'noTypescriptFeatures';

function featureSpecifierOf(entry: string): string | undefined {
  const file = resolvePath(process.cwd(), 'node_modules', entry);
  return FEATURE_IMPORT.exec(readFileSync(file, 'utf8'))?.[1];
}

async function typescriptAliasFind(): Promise<RegExp> {
  const { resolve } = await resolveConfig({ configFile: CONFIG_FILE }, 'build');
  const alias = resolve.alias.find((item) =>
    item.replacement.includes(EMPTY_MODULE),
  );
  return alias?.find as RegExp;
}

describe('alias que omite los servicios de TypeScript de Monaco', () => {
  it.each(MONACO_ENTRIES)(
    'cubre el import de %s a features/typescript/register.js',
    async (entry) => {
      const specifier = featureSpecifierOf(entry);
      expect(specifier).toBeDefined();
      expect((await typescriptAliasFind()).test(specifier as string)).toBe(
        true,
      );
    },
  );

  it('no toca otros register.js de Monaco', async () => {
    const find = await typescriptAliasFind();
    expect(find.test('./definitions/typescript/register.js')).toBe(false);
    expect(find.test('./features/css/register.js')).toBe(false);
  });
});
