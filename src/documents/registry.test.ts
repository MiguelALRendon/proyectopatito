import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import type { FileProbe, ProbeKind } from '../services/filesApi';
import { MAX_EDITABLE_BYTES } from './limits';
import {
  BINARY_SCORE,
  TEXT_SCORE,
  VIEWER_SCORE,
  matchesBinary,
  matchesImage,
  matchesMarkdown,
  matchesPdf,
  matchesText,
  registerBuiltinProviders,
} from './providers';
import {
  NO_MATCH,
  chooseProvider,
  clearProviders,
  pathExtension,
  registerProvider,
  registeredProviders,
  type DocumentProvider,
} from './registry';

const Stub = defineComponent({ template: '<div />' });

function probe(kind: ProbeKind, extra: Partial<FileProbe> = {}): FileProbe {
  return {
    kind,
    mime: 'application/octet-stream',
    len: 100,
    extension: null,
    ...extra,
  };
}

function provider(
  id: string,
  score: number | (() => number),
): DocumentProvider {
  return {
    id,
    label: id,
    matches: typeof score === 'function' ? score : () => score,
    component: Stub,
  };
}

function chosenId(path: string, found: FileProbe): string | null {
  return chooseProvider({ path, probe: found })?.id ?? null;
}

beforeEach(() => {
  clearProviders();
  registerBuiltinProviders();
});

afterEach(() => clearProviders());

describe('puntaje de los proveedores integrados', () => {
  it('un .md binario nunca es texto', () => {
    expect(chosenId('a\\falso.md', probe('binary'))).toBe('binary');
  });

  it('un texto por encima del tope del editor cae a binario', () => {
    const large = probe('text', { len: MAX_EDITABLE_BYTES + 1 });
    expect(chosenId('grande.txt', large)).toBe('binary');
  });

  it('un texto exactamente en el tope sigue siendo editable', () => {
    const exact = probe('text', { len: MAX_EDITABLE_BYTES });
    expect(chosenId('justo.txt', exact)).toBe('text');
  });

  it('un .md binario cae a binario y nunca llega al editor de Markdown', () => {
    expect(chosenId('a\\falso.md', probe('binary'))).toBe('binary');
    expect(matchesMarkdown({ path: 'falso.md', probe: probe('binary') })).toBe(
      NO_MATCH,
    );
  });

  it('un .md mayor que el tope del editor cae a binario', () => {
    const large = probe('text', { len: MAX_EDITABLE_BYTES + 1 });
    expect(chosenId('grande.md', large)).toBe('binary');
  });

  it('un .md de texto usa el editor de Markdown aunque la extensión venga en mayúsculas', () => {
    expect(chosenId('LEEME.MD', probe('text'))).toBe('markdown');
    expect(chosenId('a\\leeme.md', probe('text'))).toBe('markdown');
  });

  it('otros textos, incluso markdown o md.txt, siguen en el editor de texto', () => {
    expect(chosenId('a.markdown', probe('text'))).toBe('text');
    expect(chosenId('a.md.txt', probe('text'))).toBe('text');
    expect(chosenId('md', probe('text'))).toBe('text');
  });

  it('el visor de Markdown puntúa por encima del texto', () => {
    expect(VIEWER_SCORE).toBeGreaterThan(TEXT_SCORE);
  });

  it('decide el contenido y no el nombre: una imagen llamada .txt o .md es imagen', () => {
    expect(chosenId('foto.txt', probe('image'))).toBe('image');
    expect(chosenId('foto.md', probe('image'))).toBe('image');
  });

  it('decide el contenido y no el nombre: un PDF llamado .png o .md es PDF', () => {
    expect(chosenId('doc.png', probe('pdf'))).toBe('pdf');
    expect(chosenId('doc.md', probe('pdf'))).toBe('pdf');
  });

  it('un texto llamado .png o .pdf es texto', () => {
    expect(chosenId('falso.png', probe('text'))).toBe('text');
    expect(chosenId('falso.pdf', probe('text'))).toBe('text');
  });

  it('un binario llamado .png o .pdf es binario', () => {
    expect(chosenId('falso.png', probe('binary'))).toBe('binary');
    expect(chosenId('falso.pdf', probe('binary'))).toBe('binary');
  });

  it('una imagen y un PDF puntúan solo con su tipo', () => {
    expect(matchesImage({ path: 'a', probe: probe('pdf') })).toBe(NO_MATCH);
    expect(matchesPdf({ path: 'a', probe: probe('image') })).toBe(NO_MATCH);
    expect(matchesImage({ path: 'a', probe: probe('image') })).toBe(
      VIEWER_SCORE,
    );
    expect(matchesPdf({ path: 'a', probe: probe('pdf') })).toBe(VIEWER_SCORE);
  });

  it('una imagen o un PDF solo en la nube no coinciden con ningún proveedor', () => {
    expect(chosenId('a.png', probe('cloud'))).toBeNull();
    expect(chosenId('a.pdf', probe('cloud'))).toBeNull();
  });

  it('un archivo solo en la nube no coincide con ningún proveedor', () => {
    const cloud = probe('cloud');
    expect(matchesText({ path: 'n.txt', probe: cloud })).toBe(NO_MATCH);
    expect(matchesBinary({ path: 'n.txt', probe: cloud })).toBe(NO_MATCH);
    expect(chosenId('n.txt', cloud)).toBeNull();
  });

  it('el texto puntúa por encima del binario', () => {
    expect(TEXT_SCORE).toBeGreaterThan(BINARY_SCORE);
    expect(chosenId('a.rs', probe('text'))).toBe('text');
  });

  it('un archivo vacío de texto se abre en el editor', () => {
    expect(chosenId('vacio.txt', probe('text', { len: 0 }))).toBe('text');
  });
});

describe('registro', () => {
  it('sin proveedores devuelve null', () => {
    clearProviders();
    expect(chosenId('a.txt', probe('text'))).toBeNull();
  });

  it('gana el mayor puntaje aunque se registre después', () => {
    registerProvider(provider('markdown', 100));
    expect(chosenId('a.md', probe('text'))).toBe('markdown');
  });

  it('un proveedor nuevo con mayor puntaje registrado después gana', () => {
    registerProvider(provider('nuevo', TEXT_SCORE + 1));
    expect(chosenId('a.txt', probe('text'))).toBe('nuevo');
  });

  it('un proveedor nuevo con menor puntaje o igual registrado después no gana', () => {
    registerProvider(provider('menor', TEXT_SCORE - 1));
    registerProvider(provider('igual', TEXT_SCORE));
    expect(chosenId('a.txt', probe('text'))).toBe('text');
  });

  it('el mayor puntaje gana también si se registra antes que los demás', () => {
    clearProviders();
    registerProvider(provider('alto', 9));
    registerProvider(provider('medio', 5));
    registerProvider(provider('bajo', 1));
    expect(chosenId('a', probe('text'))).toBe('alto');
  });

  it('un empate lo gana el primero registrado', () => {
    clearProviders();
    registerProvider(provider('uno', 5));
    registerProvider(provider('dos', 5));
    expect(chosenId('a', probe('text'))).toBe('uno');
  });

  it('registrar el mismo id reemplaza sin duplicar', () => {
    registerProvider(provider('text', 50));
    expect(registeredProviders().filter((p) => p.id === 'text')).toHaveLength(
      1,
    );
    expect(chosenId('a.txt', probe('text'))).toBe('text');
  });

  it('un proveedor que lanza una excepción o devuelve un valor no finito se ignora', () => {
    registerProvider(
      provider('roto', () => {
        throw new Error('fallo');
      }),
    );
    registerProvider(provider('nan', () => Number.NaN));
    registerProvider(provider('infinito', () => Number.POSITIVE_INFINITY));
    expect(chosenId('a.txt', probe('text'))).toBe('text');
  });

  it('un puntaje negativo no cuenta como coincidencia', () => {
    clearProviders();
    registerProvider(provider('negativo', -5));
    expect(chosenId('a', probe('text'))).toBeNull();
  });

  it('la extensión de la ruta sale del último segmento', () => {
    expect(pathExtension('carpeta.v2\\archivo.MD')).toBe('md');
    expect(pathExtension('carpeta\\.gitignore')).toBe('');
    expect(pathExtension('')).toBe('');
  });
});
