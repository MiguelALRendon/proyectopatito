import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson } from './harness';
import { runPowerShell } from './pwsh';

const SEED_SCRIPT = 'scripts/e2e/seed-fixtures.ps1';

export interface FixtureManifest {
  root: string;
  workspace_root: string;
  wc_path: string;
  local_folder: string;
  old_wc_path: string;
  config_path: string;
  peer_wc_path: string;
  svn_config_dir: string;
  repo_file_url: string;
  repo_svn_url: string;
  user: string;
  password: string;
  svn_path: string;
  states: Record<string, string>;
}

export function newScratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function seedFixtures(root: string): FixtureManifest {
  runPowerShell(SEED_SCRIPT, ['-Root', root]);
  return readJson<FixtureManifest>(join(root, 'manifest.json'));
}

export function stopFixtures(root: string): void {
  runPowerShell(SEED_SCRIPT, ['-Root', root, '-Stop']);
}
