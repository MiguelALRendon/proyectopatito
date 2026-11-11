import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CommandError } from '../../services/tauri';
import { fieldOfSaveError, type RepoField } from './repoFormErrors';

const REGISTRY_SOURCE = resolve(
  process.cwd(),
  'src-tauri/src/app/marketplace/registry.rs',
);
const ERROR_ATTRIBUTE = /#\[error\(\s*"([^"]+)"\s*\)\]/g;
const PLACEHOLDER = /\{\w+\}/g;

const REGISTRY_ERRORS: Record<string, RepoField> = {
  'El nombre no puede estar vacío.': 'name',
  'El nombre no puede superar los {MAX_NAME_CHARS} caracteres.': 'name',
  'Ya existe un repositorio con ese nombre.': 'name',
  'La URL no es válida: usa http, https, svn o file, sin espacios, caracteres especiales ni contraseña incrustada.':
    'url',
  'Ya existe un repositorio con esa URL.': 'url',
  'Se alcanzó el máximo de {MAX_REPOS} repositorios.': 'form',
  'El nombre de usuario no es válido.': 'username',
  'La ruta guardada no es válida.': 'form',
  'La ruta del certificado de cliente no es válida: debe ser absoluta, terminar en .p12 o .pfx y tener a lo sumo {MAX_PATH_CHARS} caracteres.':
    'form',
  'El repositorio no existe.': 'form',
  'La URL no coincide con la del repositorio guardado.': 'url',
};

const failure = (message: string): CommandError => ({
  kind: 'invalid_path',
  message,
  codes: [],
  detail: null,
});

function registryTemplates(): string[] {
  const source = readFileSync(REGISTRY_SOURCE, 'utf8');
  return [...source.matchAll(ERROR_ATTRIBUTE)].map((match) => match[1]);
}

describe('fieldOfSaveError', () => {
  it('knows every message the registry can raise today', () => {
    expect(registryTemplates().sort()).toEqual(
      Object.keys(REGISTRY_ERRORS).sort(),
    );
  });

  it.each(Object.entries(REGISTRY_ERRORS))(
    'maps «%s» to the %s field',
    (template, field) => {
      const message = template.replace(PLACEHOLDER, '80');
      expect(fieldOfSaveError(failure(message))).toBe(field);
    },
  );

  it('prefers the username over the name when a message mentions both', () => {
    const message = 'El nombre de usuario no es válido.';
    expect(message.toLowerCase()).toContain('nombre');
    expect(fieldOfSaveError(failure(message))).toBe('username');
  });

  it('recognizes the lower-case checkout wording of an invalid url', () => {
    expect(
      fieldOfSaveError(failure('la URL no es válida: use http, https o file')),
    ).toBe('url');
  });

  it('leaves unknown messages for the general alert', () => {
    expect(fieldOfSaveError(failure('Algo inesperado.'))).toBe('form');
  });
});
