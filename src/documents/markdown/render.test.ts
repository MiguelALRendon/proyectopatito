import DOMPurify from 'dompurify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_FILE_ORIGIN } from '../../services/filesApi';
import {
  ALLOWED_ATTR,
  ALLOWED_TAGS,
  ALLOWED_URI_REGEXP,
  BLOCKED_IMAGE_CLASS,
  neutralizeBaseTags,
  renderMarkdown,
} from './render';

vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn(
      (html: string, config: { RETURN_DOM_FRAGMENT: boolean }) => {
        if (!config.RETURN_DOM_FRAGMENT) return html;
        const holder = document.createElement('div');
        holder.innerHTML = html;
        const fragment = document.createDocumentFragment();
        fragment.append(...holder.childNodes);
        return fragment;
      },
    ),
  },
}));

const BASE_DIRECTORY = 'wc\\docs';
const origin = WORKSPACE_FILE_ORIGIN;
const sanitize = vi.mocked(DOMPurify.sanitize);

function mount(markdown: string): HTMLElement {
  const root = document.createElement('article');
  root.innerHTML = renderMarkdown(markdown, BASE_DIRECTORY);
  return root;
}

function imageSources(markdown: string): (string | null)[] {
  return Array.from(mount(markdown).querySelectorAll('img'), (image) =>
    image.getAttribute('src'),
  );
}

type Config = Record<string, unknown>;

function sanitizerPasses(): [Config, Config] {
  renderMarkdown('texto', BASE_DIRECTORY);
  const [first, second] = sanitize.mock.calls.slice(-2);
  return [first[1] as Config, second[1] as Config];
}

function sanitizerConfig(): Config {
  return sanitizerPasses()[0];
}

beforeEach(() => {
  sanitize.mockClear();
});

describe('configuración del saneador', () => {
  it('pide un fragmento de DOM para reescribir después de sanear', () => {
    expect(sanitizerConfig().RETURN_DOM_FRAGMENT).toBe(true);
  });

  it('usa la lista de permitidos y no los valores por defecto', () => {
    const config = sanitizerConfig();
    expect(config.ALLOWED_TAGS).toBe(ALLOWED_TAGS);
    expect(config.ALLOWED_ATTR).toBe(ALLOWED_ATTR);
    expect(config.ALLOWED_URI_REGEXP).toBe(ALLOWED_URI_REGEXP);
  });

  it('prohíbe base de forma explícita', () => {
    expect(sanitizerConfig().FORBID_TAGS).toEqual(['base']);
  });

  it('apaga los atributos data-* y aria-* y los protocolos desconocidos', () => {
    const config = sanitizerConfig();
    expect(config.ALLOW_DATA_ATTR).toBe(false);
    expect(config.ALLOW_ARIA_ATTR).toBe(false);
    expect(config.ALLOW_UNKNOWN_PROTOCOLS).toBe(false);
  });

  it.each([
    'script',
    'style',
    'form',
    'input',
    'button',
    'svg',
    'math',
    'iframe',
    'object',
    'embed',
    'link',
    'meta',
    'base',
    'template',
    'picture',
    'source',
    'video',
    'audio',
    'noscript',
    'textarea',
  ])('la etiqueta %s no está permitida', (tag) => {
    expect(ALLOWED_TAGS).not.toContain(tag);
  });

  it.each([
    'style',
    'srcset',
    'onerror',
    'onclick',
    'class',
    'id',
    'name',
    'target',
    'formaction',
    'xlink:href',
  ])('el atributo %s no está permitido', (attribute) => {
    expect(ALLOWED_ATTR).not.toContain(attribute);
  });

  it.each(['javascript:alert(1)', 'data:text/html;base64,AA', 'vbscript:x'])(
    'la lista de URI rechaza %s',
    (uri) => {
      expect(ALLOWED_URI_REGEXP.test(uri)).toBe(false);
    },
  );

  it.each(['https://a.test/x', 'http://a.test', 'mailto:a@b.c', 'a/b.png'])(
    'la lista de URI acepta %s',
    (uri) => {
      expect(ALLOWED_URI_REGEXP.test(uri)).toBe(true);
    },
  );
});

describe('enlaces', () => {
  const links = (markdown: string) =>
    Array.from(mount(markdown).querySelectorAll('a'));

  it('ningún enlace conserva href: ni externo, ni mailto, ni relativo', () => {
    const found = links(
      '[a](https://evil.test) [b](mailto:a@b.c) [c](otro.md) [d](#ancla)',
    );
    expect(found).toHaveLength(4);
    expect(found.every((link) => !link.hasAttribute('href'))).toBe(true);
  });

  it('el destino queda en el título para que el usuario lo vea', () => {
    const [link] = links('[sitio](https://ejemplo.test/ruta)');
    expect(link.getAttribute('title')).toContain('https://ejemplo.test/ruta');
  });

  it('un enlace sin destino no inventa un título', () => {
    const [link] = links('<a>sin destino</a>');
    expect(link.hasAttribute('title')).toBe(false);
  });

  it('el texto del enlace se conserva', () => {
    const [link] = links('[texto visible](https://ejemplo.test)');
    expect(link.textContent).toBe('texto visible');
  });
});

describe('imágenes bloqueadas', () => {
  const blocked = (markdown: string) =>
    mount(markdown).querySelectorAll(`span.${BLOCKED_IMAGE_CLASS}`);

  it.each([
    ['remota http', '![x](http://evil.test/a.png)'],
    ['remota https', '![x](https://evil.test/a.png)'],
    ['sin esquema', '![x](//evil.test/a.png)'],
    ['file', '![x](file:///C:/a.png)'],
    ['data', '![x](data:image/png;base64,AAAA)'],
    ['absoluta de Windows', '![x](C:\\a.png)'],
    ['absoluta', '![x](/a.png)'],
    ['UNC', '<img src="\\\\host\\share\\a.png">'],
    ['fuera del root', '![x](../../../../a.png)'],
    ['sin src', '<img alt="x">'],
    ['con flujo alterno', '![x](a.png:flujo)'],
    ['con carácter de control', '![x](a%00.png)'],
    ['con esquema disfrazado', '<img src="  java&#x09;script:alert(1)">'],
  ])('%s: no se pide a la red y se muestra un aviso', (_name, markdown) => {
    expect(imageSources(markdown)).toEqual([]);
    expect(blocked(markdown)).toHaveLength(1);
  });

  it('el aviso incluye el texto alternativo', () => {
    const [notice] = blocked('![mi foto](http://evil.test/a.png)');
    expect(notice.textContent).toContain('mi foto');
  });

  it('el aviso no incluye la dirección remota', () => {
    const [notice] = blocked('![x](http://evil.test/a.png)');
    expect(notice.textContent).not.toContain('evil.test');
  });
});

describe('reescritura de imágenes relativas al protocolo', () => {
  it('una ruta relativa se resuelve contra la carpeta del documento', () => {
    expect(imageSources('![x](a.png)')).toEqual([`${origin}/wc/docs/a.png`]);
  });

  it('./ no cambia la ruta', () => {
    expect(imageSources('![x](./a.png)')).toEqual([`${origin}/wc/docs/a.png`]);
  });

  it('.. sube una carpeta', () => {
    expect(imageSources('![x](../img/a.png)')).toEqual([
      `${origin}/wc/img/a.png`,
    ]);
  });

  it('.. puede llegar justo hasta la raíz del espacio de trabajo', () => {
    expect(imageSources('![x](../../a.png)')).toEqual([`${origin}/a.png`]);
  });

  it('.. más allá de la raíz se bloquea', () => {
    expect(imageSources('![x](../../../a.png)')).toEqual([]);
  });

  it('%2e%2e se trata como .. y no escapa', () => {
    expect(imageSources('![x](%2e%2e/%2e%2e/%2e%2e/a.png)')).toEqual([]);
  });

  it('%2e%2e dentro del espacio de trabajo sube como ..', () => {
    expect(imageSources('![x](%2e%2e/a.png)')).toEqual([`${origin}/wc/a.png`]);
  });

  it('la barra invertida separa carpetas', () => {
    expect(imageSources('![x](<sub\\a.png>)')).toEqual([
      `${origin}/wc/docs/sub/a.png`,
    ]);
  });

  it('los espacios se codifican', () => {
    expect(imageSources('![x](<mi imagen.png>)')).toEqual([
      `${origin}/wc/docs/mi%20imagen.png`,
    ]);
  });

  it('una almohadilla escrita como %23 es parte del nombre', () => {
    expect(imageSources('![x](a%23b.png)')).toEqual([
      `${origin}/wc/docs/a%23b.png`,
    ]);
  });

  it('una almohadilla sin escapar abre un fragmento y no es parte del nombre', () => {
    expect(imageSources('![x](a.png#zoom)')).toEqual([
      `${origin}/wc/docs/a.png`,
    ]);
  });

  it('una consulta no viaja al protocolo', () => {
    expect(imageSources('![x](a.png?v=2)')).toEqual([
      `${origin}/wc/docs/a.png`,
    ]);
  });

  it('el porcentaje escapado %25 se conserva como %', () => {
    expect(imageSources('![x](a%25b.png)')).toEqual([
      `${origin}/wc/docs/a%25b.png`,
    ]);
  });

  it('un porcentaje suelto no rompe la ruta', () => {
    expect(imageSources('![x](100%.png)')).toEqual([
      `${origin}/wc/docs/100%25.png`,
    ]);
  });

  it('la eñe viaja codificada en UTF-8', () => {
    expect(imageSources('![x](ñandú.png)')).toEqual([
      `${origin}/wc/docs/%C3%B1and%C3%BA.png`,
    ]);
  });

  it('un nombre con todo junto sobrevive al ciclo', () => {
    expect(imageSources('![x](<a%23b%25c d ñ.png>)')).toEqual([
      `${origin}/wc/docs/a%23b%25c%20d%20%C3%B1.png`,
    ]);
  });

  it('la carpeta del documento también se codifica', () => {
    const root = document.createElement('article');
    root.innerHTML = renderMarkdown('![x](a.png)', 'mis docs\\ñ #1');
    expect(root.querySelector('img')?.getAttribute('src')).toBe(
      `${origin}/mis%20docs/%C3%B1%20%231/a.png`,
    );
  });
});

describe('neutralizeBaseTags', () => {
  it.each([
    '<base href="http://evil.test/">',
    '<BASE HREF=http://evil.test/>',
    '<base/>',
    '<base\nhref="x">',
  ])('deja %j como texto escapado', (tag) => {
    const result = neutralizeBaseTags(`a${tag}b`);
    expect(result).not.toMatch(/<base/i);
    expect(result.startsWith('a&lt;base')).toBe(true);
  });

  it('una etiqueta partida por otra anidada no reaparece', () => {
    expect(neutralizeBaseTags('<ba<base>se href="x">')).not.toMatch(/<base/i);
  });

  it('no toca etiquetas parecidas ni texto escapado', () => {
    const intact = '<basefont size=1> &lt;base href=x&gt; <p>base</p>';
    expect(neutralizeBaseTags(intact)).toBe(intact);
  });

  it('renderMarkdown entrega al saneador un HTML sin base', () => {
    renderMarkdown('<base href="http://evil.test/">\n\ntexto', BASE_DIRECTORY);
    const [first] = sanitize.mock.calls.slice(-2);
    expect(String(first[0])).not.toMatch(/<base/i);
  });
});

describe('neutralizeBaseTags: entrada adversaria grande', () => {
  const BUDGET_MS = 1500;
  const NESTING = 100_000;
  const timed = (html: string) => {
    const start = performance.now();
    const result = neutralizeBaseTags(html);
    return { result, elapsed: performance.now() - start };
  };

  it('un anidamiento de 100 000 niveles (~600 KB) termina en tiempo acotado', () => {
    const html = `${'<'.repeat(NESTING)}<base>${'base>'.repeat(NESTING)}`;
    const { result, elapsed } = timed(html);
    expect(elapsed).toBeLessThan(BUDGET_MS);
    expect(result).not.toMatch(/<base/i);
  });

  it('1,2 MB de aperturas sin cierre no es cuadrático', () => {
    const { result, elapsed } = timed('<base '.repeat(200_000));
    expect(elapsed).toBeLessThan(BUDGET_MS);
    expect(result).not.toMatch(/<base/i);
  });
});

describe('segunda pasada del saneador', () => {
  it('sanea el HTML serializado con la misma lista de permitidos', () => {
    const [first, second] = sanitizerPasses();
    expect(second.ALLOWED_TAGS).toBe(first.ALLOWED_TAGS);
    expect(second.ALLOWED_ATTR).toBe(first.ALLOWED_ATTR);
    expect(second.ALLOWED_URI_REGEXP).toBe(first.ALLOWED_URI_REGEXP);
    expect(second.FORBID_TAGS).toEqual(['base']);
    expect(second.RETURN_DOM_FRAGMENT).toBe(false);
  });

  it('recibe el HTML ya reescrito, con la imagen apuntando al protocolo', () => {
    renderMarkdown('![x](a.png)', BASE_DIRECTORY);
    const [, second] = sanitize.mock.calls.slice(-2);
    expect(String(second[0])).toContain(`src="${origin}/wc/docs/a.png"`);
  });

  it('entrega lo que devuelve la segunda pasada', () => {
    sanitize.mockImplementationOnce(
      () => document.createDocumentFragment() as never,
    );
    sanitize.mockImplementationOnce(() => 'resultado final');
    expect(renderMarkdown('texto', BASE_DIRECTORY)).toBe('resultado final');
  });

  it('solo añade span con class, para el aviso de imagen bloqueada', () => {
    const second = sanitizerPasses()[1] as {
      ADD_TAGS: (tag: string) => boolean;
      ADD_ATTR: (attribute: string, tag: string) => boolean;
    };
    expect(['span', 'a', 'div', 'script'].filter(second.ADD_TAGS)).toEqual([
      'span',
    ]);
    expect(second.ADD_ATTR('class', 'span')).toBe(true);
    expect(second.ADD_ATTR('class', 'p')).toBe(false);
    expect(second.ADD_ATTR('style', 'span')).toBe(false);
    expect(second.ADD_ATTR('onclick', 'span')).toBe(false);
  });
});

describe('Markdown legítimo', () => {
  it('encabezados, énfasis, listas, código y tablas llegan al saneador', () => {
    const root = mount(
      '# Título\n\n**negrita** y *cursiva*\n\n- uno\n- dos\n\n`código`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
    );
    const found = ['h1', 'strong', 'em', 'ul li', 'code', 'table td'];
    expect(found.map((selector) => root.querySelector(selector))).not.toContain(
      null,
    );
  });

  it('una imagen relativa válida conserva texto alternativo y título', () => {
    const image = mount('![logo](logo.png "pie")').querySelector('img');
    expect(image?.getAttribute('alt')).toBe('logo');
    expect(image?.getAttribute('title')).toBe('pie');
  });
});
