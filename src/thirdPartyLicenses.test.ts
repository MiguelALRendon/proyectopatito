import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DOCUMENT = readFileSync('THIRD_PARTY_LICENSES.md', 'utf-8');
const PACKAGE = JSON.parse(readFileSync('package.json', 'utf-8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const CARGO = readFileSync('src-tauri/Cargo.toml', 'utf-8');
const NPM_TITLE = '## Paquetes de npm que llegan a la interfaz';
const CRATES_TITLE = '## Crates de Rust enlazados en el ejecutable';
const UNDECLARED = 'sin declarar';

function section(title: string, next?: string): string {
  const start = DOCUMENT.indexOf(title);
  const end = next ? DOCUMENT.indexOf(next, start) : DOCUMENT.length;
  return DOCUMENT.slice(start, end);
}

function rows(text: string): [string, string][] {
  return text
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.startsWith('| ') &&
        !line.startsWith('| Paquete') &&
        !/^\|\s*-/.test(line),
    )
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map((cells): [string, string] => [cells[1], cells[2]]);
}

function cargoDependencies(): string[] {
  const body = /\[dependencies\]([\s\S]*?)(\r?\n\[|$)/.exec(CARGO)?.[1] ?? '';
  return [...body.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((match) => match[1]);
}

const npmRows = rows(section(NPM_TITLE, CRATES_TITLE));
const crateRows = rows(section(CRATES_TITLE));

describe('THIRD_PARTY_LICENSES.md frente a las dependencias reales', () => {
  it('lista cada dependencia de ejecución de npm', () => {
    const names = npmRows.map(([name]) => name.replace(/ \S+$/, ''));
    for (const dependency of Object.keys(PACKAGE.dependencies)) {
      expect(names, dependency).toContain(dependency);
    }
  });

  it('no lista las herramientas de desarrollo de npm', () => {
    const names = new Set(npmRows.map(([name]) => name.replace(/ \S+$/, '')));
    for (const tool of ['vitest', '@vue/test-utils', 'happy-dom', 'prettier']) {
      expect(PACKAGE.devDependencies[tool], tool).toBeDefined();
      expect(names.has(tool), tool).toBe(false);
    }
  });

  it('cada versión documentada existe en package-lock.json y en Cargo.lock', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf-8')) as {
      packages: Record<string, { version?: string }>;
    };
    const installed = new Set(
      Object.entries(lock.packages)
        .filter(([path]) => path !== '')
        .map(([path, info]) => {
          const name = path.slice(path.lastIndexOf('node_modules/') + 13);
          return `${name} ${info.version}`;
        }),
    );
    for (const [name] of npmRows) {
      expect(installed.has(name), name).toBe(true);
    }
    const cargoLock = readFileSync('src-tauri/Cargo.lock', 'utf-8');
    const crates = new Set(
      [...cargoLock.matchAll(/name = "([^"]+)"\r?\nversion = "([^"]+)"/g)].map(
        (match) => `${match[1]} v${match[2]}`,
      ),
    );
    expect(crates.size).toBeGreaterThan(100);
    for (const [name] of crateRows) {
      expect(crates.has(name), name).toBe(true);
    }
  });

  it('lista cada crate de ejecución declarado en Cargo.toml', () => {
    const names = crateRows.map(([name]) => name.replace(/ \S+$/, ''));
    const declared = cargoDependencies();
    expect(declared.length).toBeGreaterThan(5);
    for (const dependency of declared) {
      expect(names, dependency).toContain(dependency);
    }
  });

  it('la licencia que falta se marca «sin declarar» y nunca queda una celda vacía', () => {
    const everyRow = [...npmRows, ...crateRows];
    expect(everyRow.length).toBeGreaterThan(100);
    for (const [name, license] of everyRow) {
      expect(license, name).not.toBe('');
      expect(license === UNDECLARED || /[A-Za-z]/.test(license), name).toBe(
        true,
      );
    }
  });

  it('el recuento anunciado de cada tabla coincide con sus filas', () => {
    const announced = (title: string, next?: string) =>
      Number(/(\d+) (?:paquetes|crates)\)/.exec(section(title, next))?.[1]);
    expect(announced(NPM_TITLE, CRATES_TITLE)).toBe(npmRows.length);
    expect(announced(CRATES_TITLE)).toBe(crateRows.length);
  });
});

describe('avisos de licencia de ZetaOffice en el instalador', () => {
  const folder = 'third_party/licenses/zetaoffice';
  const files = [
    'license.xml',
    'qt-LICENSE.LGPL3.txt',
    'qt-LICENSE.GPL3.txt',
    'zetajs-LICENSE.txt',
  ];

  it('cada aviso existe, no está vacío y su SHA-256 coincide con el del README', () => {
    const readme = readFileSync(`${folder}/README.md`, 'utf-8');
    for (const name of files) {
      const bytes = readFileSync(`${folder}/${name}`);
      expect(bytes.length, name).toBeGreaterThan(1000);
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(readme, name).toContain(hash);
    }
  });

  it('los textos son los que se dice: MPL en license.xml, LGPL 3, GPL 3 y MIT', () => {
    const text = (name: string) => readFileSync(`${folder}/${name}`, 'utf-8');
    expect(text('license.xml')).toContain('Mozilla Public License');
    expect(text('qt-LICENSE.LGPL3.txt')).toContain(
      'GNU LESSER GENERAL PUBLIC LICENSE',
    );
    expect(text('qt-LICENSE.GPL3.txt')).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(text('zetajs-LICENSE.txt')).toContain('MIT');
  });

  it('el instalador los lleva en zetaoffice-licenses y el aviso de terceros lo dice', () => {
    const config = JSON.parse(
      readFileSync('src-tauri/tauri.conf.json', 'utf-8'),
    ) as {
      bundle: { resources: Record<string, string> };
    };
    expect(config.bundle.resources['../third_party/licenses/zetaoffice']).toBe(
      'zetaoffice-licenses',
    );
    expect(DOCUMENT).toContain('zetaoffice-licenses');
  });
});
