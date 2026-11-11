import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export function runPowerShell(script: string, args: string[]): string {
  const result = spawnSync(
    'pwsh',
    ['-NoProfile', '-File', resolve(script), ...args],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`${script} fallo: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}
