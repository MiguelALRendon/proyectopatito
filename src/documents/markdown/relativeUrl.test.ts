import { describe, expect, it } from 'vitest';
import { WORKSPACE_FILE_ORIGIN } from '../../services/filesApi';
import { classifyImage, resolveRelative } from './relativeUrl';

const BASE = 'wc\\docs';

describe('resolveRelative', () => {
  it.each([
    ['', 'referencia vacía'],
    ['   ', 'solo espacios'],
    ['http://a.test/x.png', 'esquema http'],
    ['HTTPS://a.test/x.png', 'esquema en mayúsculas'],
    ['\u0001javascript:alert(1)', 'control antes del esquema'],
    ['java\tscript:alert(1)', 'tabulador dentro del esquema'],
    ['//host/x.png', 'sin esquema'],
    ['\\\\host\\x.png', 'UNC'],
    ['/x.png', 'raíz'],
    ['C:\\x.png', 'unidad'],
    ['../../../x.png', 'sube más allá de la raíz'],
    ['%2e%2e/%2e%2e/%2e%2e/x.png', 'sube codificado'],
    ['..%5C..%5C..%5Cx.png', 'sube con barra invertida codificada'],
    ['a%3Ab.png', 'dos puntos codificados'],
    ['a%00b.png', 'nulo codificado'],
    ['a%3F.png', 'comodín codificado'],
  ])('rechaza %j (%s)', (reference) => {
    expect(resolveRelative(reference, BASE)).toBeNull();
  });

  it('resuelve contra la carpeta del documento', () => {
    expect(resolveRelative('a/b.png', BASE)).toBe('wc/docs/a/b.png');
  });

  it('ignora segmentos vacíos y puntos', () => {
    expect(resolveRelative('./a//./b.png', BASE)).toBe('wc/docs/a/b.png');
  });

  it('descarta fragmento y consulta', () => {
    expect(resolveRelative('a.png?x=1#y', BASE)).toBe('wc/docs/a.png');
  });

  it('decodifica una secuencia UTF-8 válida', () => {
    expect(resolveRelative('%C3%B1.png', BASE)).toBe('wc/docs/ñ.png');
  });

  it('deja intacta una secuencia UTF-8 inválida', () => {
    expect(resolveRelative('%FF.png', BASE)).toBe('wc/docs/%FF.png');
  });

  it('.. y . sin nombre apuntan a la propia carpeta', () => {
    expect(resolveRelative('..', BASE)).toBe('wc');
    expect(resolveRelative('.', BASE)).toBe('wc/docs');
  });

  it('desde la raíz del espacio de trabajo no hay nada por encima', () => {
    expect(resolveRelative('../a.png', '')).toBeNull();
  });
});

describe('classifyImage', () => {
  it('distingue lo remoto de lo inseguro', () => {
    expect(classifyImage('http://a.test/x.png', BASE)).toEqual({
      kind: 'blocked',
      reason: 'remote',
    });
    expect(classifyImage('../../../x.png', BASE)).toEqual({
      kind: 'blocked',
      reason: 'unsafe',
    });
  });

  it('una ruta del espacio de trabajo devuelve la URL del protocolo', () => {
    expect(classifyImage('a b.png', BASE)).toEqual({
      kind: 'workspace',
      url: `${WORKSPACE_FILE_ORIGIN}/wc/docs/a%20b.png`,
    });
  });
});
