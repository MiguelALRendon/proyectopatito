import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SUSPICION_LABELS,
  countLabel,
  displayName,
  hasHiddenCharacters,
  isOneDrivePath,
  progressFraction,
  suspicionReasons,
} from './archive';

const RLO = String.fromCharCode(0x202e);
const ZERO_WIDTH = String.fromCharCode(0x200b);

describe('isOneDrivePath', () => {
  it('reconoce la carpeta OneDrive personal y la de empresa', () => {
    expect(isOneDrivePath('C:\\Users\\ana\\OneDrive\\Docs\\a.zip')).toBe(true);
    expect(isOneDrivePath('C:\\Users\\ana\\OneDrive - Acme SA\\a.zip')).toBe(
      true,
    );
    expect(isOneDrivePath('C:/Users/ana/onedrive/a.zip')).toBe(true);
  });

  it('no se deja engañar por nombres parecidos', () => {
    expect(isOneDrivePath('C:\\work\\OneDriveBackup\\a.zip')).toBe(false);
    expect(isOneDrivePath('C:\\work\\MiOneDrive\\a.zip')).toBe(false);
    expect(isOneDrivePath('C:\\work\\a.zip')).toBe(false);
  });
});

describe('displayName', () => {
  it('deja visibles los controles bidireccionales, de ancho cero y C0', () => {
    expect(displayName(`foto${RLO}gpj.exe`)).toBe('foto‹U+202E›gpj.exe');
    expect(displayName(`a${ZERO_WIDTH}b`)).toBe('a‹U+200B›b');
    expect(displayName('a\u0001b')).toBe('a‹U+0001›b');
  });

  it('no toca el HTML ni los nombres normales: lo escapa Vue al pintar', () => {
    expect(displayName('<img src=x onerror=1>.txt')).toBe(
      '<img src=x onerror=1>.txt',
    );
    expect(displayName('informe ñ 日本.txt')).toBe('informe ñ 日本.txt');
  });

  it('hasHiddenCharacters coincide con lo que displayName cambia', () => {
    expect(hasHiddenCharacters(`x${RLO}y`)).toBe(true);
    expect(hasHiddenCharacters('x y')).toBe(false);
  });
});

describe('suspicionReasons', () => {
  it('traduce cada código y no inventa los desconocidos', () => {
    const reasons = suspicionReasons(['declared_size', 'ratio', 'depth']);
    expect(new Set(reasons).size).toBe(3);
    expect(suspicionReasons(['otro'])).toEqual([
      'tiene una característica fuera de lo habitual',
    ]);
    expect(suspicionReasons([])).toEqual([]);
  });
});

describe('progressFraction', () => {
  const at = (bytes: number, total: number) =>
    progressFraction({ id: 1, files: 1, bytes, total_bytes: total });

  it('es cero sin progreso o sin total', () => {
    expect(progressFraction(null)).toBe(0);
    expect(at(10, 0)).toBe(0);
  });

  it('avanza proporcionalmente y nunca pasa de 1', () => {
    expect(at(25, 100)).toBe(0.25);
    expect(at(100, 100)).toBe(1);
    expect(at(150, 100)).toBe(1);
  });
});

describe('countLabel', () => {
  it('concuerda en singular y plural', () => {
    expect(countLabel(1, 'archivo', 'archivos')).toBe('1 archivo');
    expect(countLabel(0, 'archivo', 'archivos')).toBe('0 archivos');
    expect(countLabel(2, 'archivo', 'archivos')).toBe('2 archivos');
  });
});

describe('SUSPICION_LABELS frente a los límites de Rust', () => {
  const limits = readFileSync('src-tauri/src/app/archive/limits.rs', 'utf-8');
  const gibOf = (name: string) =>
    Number(
      new RegExp(`${name}: u64 = (\\d+) \\* GIB`).exec(limits)?.[1] ?? NaN,
    );

  it('el motivo de tamaño declarado muestra el mismo umbral que aplica el backend', () => {
    const total = gibOf('MAX_EXTRACT_BYTES');
    const single = gibOf('MAX_ENTRY_BYTES');
    expect([total, single]).toEqual([4, 2]);
    expect(SUSPICION_LABELS.declared_size).toContain(`${total} GiB en total`);
    expect(SUSPICION_LABELS.declared_size).toContain(
      `${single} GiB en un archivo`,
    );
  });
});
