import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const PDFJS_DIR = resolvePath(process.cwd(), 'node_modules', 'pdfjs-dist');
const EVAL_CALL = /(?<![\w$])eval\s*\(/;
const FUNCTION_CONSTRUCTOR = /\bnew\s+Function\s*\(/;
const RETIRED_OPTION = 'isEvalSupported';
const SHIPPED_FILES = [
  'build/pdf.mjs',
  'build/pdf.worker.mjs',
  'types/src/display/api.d.ts',
];

function sourceOf(relative: string): string {
  return readFileSync(resolvePath(PDFJS_DIR, relative), 'utf8');
}

describe('pdfjs-dist no evalúa código dinámico', () => {
  it.each(['build/pdf.mjs', 'build/pdf.worker.mjs'])(
    '%s no contiene eval() ni new Function()',
    (file) => {
      const source = sourceOf(file);
      expect(EVAL_CALL.test(source)).toBe(false);
      expect(FUNCTION_CONSTRUCTOR.test(source)).toBe(false);
    },
  );

  it.each(SHIPPED_FILES)(
    '%s no ofrece la opción isEvalSupported: si vuelve, hay que pasarla en false',
    (file) => {
      expect(sourceOf(file)).not.toContain(RETIRED_OPTION);
    },
  );
});
