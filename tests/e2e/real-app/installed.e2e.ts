import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLAIN_ENTRIES, zipBytes } from './archiveFixtures';
import {
  VISIBLE_TIMEOUT_MS,
  documentTab,
  fileRow,
  removeDir,
} from './editorDriver';
import {
  newScratchDir,
  seedFixtures,
  stopFixtures,
  type FixtureManifest,
} from './fixtures';
import { launchApp, readJson, type AppSession } from './harness';
import { RECORDINGS, record, wavBytes } from './mediaFixtures';
import { runPowerShell } from './pwsh';
import { closeDocument, showFolder } from './viewersDriver';

const INSTALLER = process.env.INSTALLER_PATH;
const VERIFY_SCRIPT = 'scripts/e2e/verify-installer.ps1';
const OFFICE_SCRIPT = 'scripts/e2e/make-office-fixtures.ps1';
const WC = 'wc';
const FOLDER = 'zona-instalado';
const CHECKOUT_NAME = 'instalado-wc';
const SUITE_TIMEOUT_MS = 900_000;
const OFFICE_TIMEOUT_MS = 180_000;
const COMMIT_MESSAGE = 'commit desde la aplicacion instalada';
const PLAYER = '[role="group"][aria-label^="Reproductor de"]';
const OFFICE_READY = '.office-viewer__stage[data-phase="ready"]';

interface Installed {
  Exe: string;
  InstalledMiB: number;
  ConfigDir: string;
}

let manifest: FixtureManifest;
let seedRoot: string;
let installRoot: string;
let installed: Installed;
let app: AppSession;
const keep: string[] = [];

function folderPath(name = ''): string {
  return join(manifest.wc_path, FOLDER, name);
}

async function enterFolder(page: Page, name: string): Promise<void> {
  await page
    .getByRole('row', { name: new RegExp(`^Carpeta: ${name}`) })
    .dblclick();
  await page
    .getByRole('navigation', { name: 'Ruta de navegación' })
    .locator('[aria-current="page"]', { hasText: name })
    .waitFor();
}

async function openFromFolder(page: Page, name: string): Promise<void> {
  await showFolder(page, WC);
  await enterFolder(page, FOLDER);
  await fileRow(page, name).dblclick();
  await documentTab(page, name).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
}

async function seedFolder(page: Page): Promise<void> {
  mkdirSync(folderPath(), { recursive: true });
  const office = mkdtempSync(join(tmpdir(), 'dakedaduck-inst-office-'));
  keep.push(office);
  runPowerShell(OFFICE_SCRIPT, ['-OutDir', office]);
  copyFileSync(join(office, 'documento.docx'), folderPath('documento.docx'));
  writeFileSync(folderPath('sonido.wav'), wavBytes());
  writeFileSync(folderPath('datos.zip'), zipBytes(PLAIN_ENTRIES));
  writeFileSync(folderPath('texto.txt'), 'texto de prueba\n');
  const clip = RECORDINGS.find((item) => item.name === 'clip.webm');
  const bytes = clip ? await record(page, clip) : null;
  if (bytes) writeFileSync(folderPath('clip.webm'), bytes);
}

function writeConfig(extra: Record<string, unknown> = {}): void {
  const { svn_path: unused, ...config } = readJson<Record<string, unknown>>(
    manifest.config_path,
  );
  void unused;
  mkdirSync(installed.ConfigDir, { recursive: true });
  writeFileSync(
    join(installed.ConfigDir, 'config.json'),
    JSON.stringify({ ...config, ...extra }),
  );
}

async function relaunch(extra: Record<string, unknown> = {}): Promise<void> {
  app.stop();
  writeConfig(extra);
  app = await launchApp({
    configDir: installed.ConfigDir,
    exe: installed.Exe,
    isolatedRoot: installRoot,
    mode: 'release',
  });
}

async function aboutText(
  page: Page,
): Promise<{ facts: string; licenses: string }> {
  await page.getByText('Cargando…').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Acerca de' }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('heading', { name: 'Licencias de terceros' })
    .waitFor();
  const facts = await dialog.locator('.about__facts').innerText();
  const licenses = await dialog.locator('pre').innerText();
  await dialog.getByRole('button', { name: 'Cerrar' }).click();
  return { facts: facts.replace(/\s+/g, ' '), licenses };
}

function runSvn(args: string[]): string {
  return execFileSync(
    manifest.svn_path,
    [
      '--config-dir',
      join(manifest.root, 'svn-config'),
      '--non-interactive',
      ...args,
    ],
    { encoding: 'utf8' },
  );
}

beforeAll(async () => {
  if (!INSTALLER) return;
  seedRoot = newScratchDir('dakedaduck-e2e-');
  manifest = seedFixtures(seedRoot);
  installRoot = newScratchDir('dakedaduck-inst-');
  installed = JSON.parse(
    runPowerShell(VERIFY_SCRIPT, [
      '-Root',
      installRoot,
      '-Installer',
      INSTALLER,
    ]),
  ) as Installed;
  writeConfig();
  app = await launchApp({
    configDir: installed.ConfigDir,
    exe: installed.Exe,
    isolatedRoot: installRoot,
    mode: 'release',
  });
  await seedFolder(app.page);
  await app.reload();
}, SUITE_TIMEOUT_MS);

afterAll(() => {
  app?.stop();
  keep.forEach(removeDir);
  if (seedRoot) {
    stopFixtures(seedRoot);
    removeDir(seedRoot);
  }
});

describe.skipIf(!INSTALLER)(
  'la aplicación instalada, en un entorno vacío',
  () => {
    it('arranca aislada y sin tocar nada fuera de su carpeta', async () => {
      expect(await app.cspViolations()).toEqual([]);
      expect(app.externalRequests).toEqual([]);
      await app.capture('instalado-arranque');
    });

    it('detecta el svn incluido sin Subversion en PATH ni en ProgramFiles', async () => {
      const about = await aboutText(app.page);
      expect(about.facts).toContain('1.14.5 (incluido con la aplicación)');
      expect(about.licenses).toContain('SlikSVN 1.14.5');
      expect(about.licenses).toContain('Oferta de código fuente');
    });

    it(
      'abre texto, comprimido, audio y vídeo',
      async () => {
        const { page } = app;
        await openFromFolder(page, 'texto.txt');
        await page
          .locator('.monaco-editor')
          .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
        await closeDocument(page, 'texto.txt');
        await openFromFolder(page, 'datos.zip');
        await page
          .getByRole('table', { name: 'Contenido del archivo comprimido' })
          .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
        await closeDocument(page, 'datos.zip');
        await openFromFolder(page, 'sonido.wav');
        await page.locator(PLAYER).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
        await closeDocument(page, 'sonido.wav');
        if (readdirSync(folderPath()).includes('clip.webm')) {
          await openFromFolder(page, 'clip.webm');
          await page.locator(PLAYER).waitFor({ timeout: VISIBLE_TIMEOUT_MS });
          await closeDocument(page, 'clip.webm');
        }
      },
      SUITE_TIMEOUT_MS,
    );

    it(
      'abre un PDF',
      async () => {
        await showFolder(app.page, WC);
        await fileRow(app.page, 'documento-multipagina.pdf').dblclick();
        await app.page
          .getByRole('region', { name: 'Visor de PDF' })
          .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
        await closeDocument(app.page, 'documento-multipagina.pdf');
      },
      SUITE_TIMEOUT_MS,
    );

    it(
      'abre un docx en ZetaOffice instalado',
      async () => {
        await openFromFolder(app.page, 'documento.docx');
        await app.page
          .locator(OFFICE_READY)
          .waitFor({ timeout: OFFICE_TIMEOUT_MS });
        await app.capture('instalado-office');
        await closeDocument(app.page, 'documento.docx');
      },
      OFFICE_TIMEOUT_MS + 60_000,
    );

    it(
      'hace checkout y commit con el svn incluido',
      async () => {
        const { page } = app;
        await showFolder(page, WC);
        await page
          .getByRole('navigation', { name: 'Ruta de navegación' })
          .getByRole('button', { name: 'Mis archivos' })
          .click();
        await enterFolder(page, 'local-folder');
        await page
          .getByLabel('URL del repositorio')
          .fill(manifest.repo_file_url);
        await page.getByLabel('Carpeta en el workspace').fill(CHECKOUT_NAME);
        await page.getByRole('button', { name: 'Hacer checkout' }).click();
        const checkout = join(manifest.workspace_root, CHECKOUT_NAME);
        await expect
          .poll(() => readdirSync(checkout).length, {
            timeout: VISIBLE_TIMEOUT_MS,
          })
          .toBeGreaterThan(0);
        await page
          .getByRole('navigation', { name: 'Ruta de navegación' })
          .getByRole('button', { name: 'Mis archivos' })
          .click();
        await enterFolder(page, CHECKOUT_NAME);
        await page
          .getByRole('region', { name: /Estado de la copia/ })
          .waitFor({ timeout: VISIBLE_TIMEOUT_MS });
        await expect
          .poll(
            () =>
              page
                .locator('button.btn--primary', { hasText: 'Actualizar' })
                .isEnabled(),
            { timeout: VISIBLE_TIMEOUT_MS },
          )
          .toBe(true);
        const tracked = 'lf.txt';
        expect(runSvn(['ls', manifest.repo_file_url])).toContain(tracked);
        writeFileSync(join(checkout, tracked), 'cambio desde el instalado\n');
        await page.getByRole('button', { name: 'Refrescar estado' }).click();
        await page.getByRole('button', { name: 'Confirmar' }).first().click();
        await page.getByLabel('Mensaje').fill(COMMIT_MESSAGE);
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Confirmar' })
          .click();
        await expect
          .poll(() => runSvn(['log', '-l', '1', manifest.repo_file_url]), {
            timeout: VISIBLE_TIMEOUT_MS,
          })
          .toContain(COMMIT_MESSAGE);
      },
      SUITE_TIMEOUT_MS,
    );

    it(
      'una ruta de svn configurada gana al svn incluido',
      async () => {
        await relaunch({ svn_path: manifest.svn_path });
        const about = await aboutText(app.page);
        expect(about.facts).toContain('elegido por ti');
        expect(about.facts).not.toContain('incluido con la aplicación');
      },
      SUITE_TIMEOUT_MS,
    );

    it(
      'un archivo alterado del svn incluido se ignora y la ventana avisa con el nombre del archivo',
      async () => {
        const target = join(
          installRoot,
          'app',
          'svn',
          'SlikSvn-libsvn_subr-1.dll',
        );
        const original = readFileSync(target);
        writeFileSync(target, Buffer.concat([original, Buffer.from('x')]));
        try {
          await relaunch();
          const banner = app.page.getByRole('alert').filter({
            hasText: 'svn.exe incluido',
          });
          await banner.waitFor({ timeout: VISIBLE_TIMEOUT_MS });
          expect(await banner.innerText()).toContain(
            'SlikSvn-libsvn_subr-1.dll',
          );
        } finally {
          writeFileSync(target, original);
        }
      },
      SUITE_TIMEOUT_MS,
    );

    it('se desinstala sin procesos huérfanos ni archivos', () => {
      app.stop();
      const result = readJson<{ Orphans: number; FilesLeft: number }>(
        writeResult(
          runPowerShell(VERIFY_SCRIPT, ['-Root', installRoot, '-Uninstall']),
        ),
      );
      expect(result).toEqual({ Orphans: 0, FilesLeft: 0 });
    });
  },
);

function writeResult(json: string): string {
  const path = join(installRoot, 'uninstall-result.json');
  writeFileSync(path, json);
  return path;
}
