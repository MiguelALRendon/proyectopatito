import './happyDomPurifyShim';
import DOMPurify from 'dompurify';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_FILE_ORIGIN } from '../../services/filesApi';
import {
  ALLOWED_ATTR,
  ALLOWED_TAGS,
  BLOCKED_IMAGE_CLASS,
  renderMarkdown,
} from './render';
import { auditSnapshot, snapshotDom, type AuditPolicy } from './xssAudit';
import { XSS_CORPUS, XSS_FLAG } from './xssCorpus';

interface HappyDomControl {
  happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: boolean } };
}

const BASE_DIRECTORY = 'wc\\docs';
const ROOT_SELECTOR = '#raiz';
const POLICY: AuditPolicy = {
  tags: ALLOWED_TAGS,
  attributes: ALLOWED_ATTR,
  workspaceOrigin: WORKSPACE_FILE_ORIGIN,
  blockedClass: BLOCKED_IMAGE_CLASS,
};

function render(markdown: string): HTMLElement {
  document.body.innerHTML = '<article id="raiz"></article>';
  const root = document.querySelector<HTMLElement>(ROOT_SELECTOR)!;
  root.innerHTML = renderMarkdown(markdown, BASE_DIRECTORY);
  return root;
}

function attributeNames(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('*')).flatMap((element) =>
    element.getAttributeNames(),
  );
}

beforeAll(() => {
  const { settings } = (window as unknown as HappyDomControl).happyDOM;
  settings.handleDisabledFileLoadingAsSuccess = true;
  const report = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((error: unknown) => {
    const isDisabledLoad =
      error instanceof DOMException && error.name === 'NotSupportedError';
    if (!isDisabledLoad) report(error);
  });
});

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>)[XSS_FLAG];
});

describe('el saneador real', () => {
  it('DOMPurify no está sustituido y es compatible con este entorno', () => {
    expect(vi.isMockFunction(DOMPurify.sanitize)).toBe(false);
    expect(DOMPurify.isSupported).toBe(true);
    expect(DOMPurify.sanitize('<script>x</script>a', {})).toBe('a');
  });
});

describe('corpus hostil por el saneador real', () => {
  it.each(XSS_CORPUS.map(({ name, markdown }) => [name, markdown]))(
    '%s: el resultado cumple la política completa',
    (_name, markdown) => {
      const root = render(markdown);
      expect(auditSnapshot(snapshotDom(ROOT_SELECTOR), POLICY)).toEqual([]);
      expect(attributeNames(root).filter((name) => /^on/i.test(name))).toEqual(
        [],
      );
      expect(root.querySelector('a[href], img:not([src])')).toBeNull();
      expect((window as unknown as Record<string, unknown>)[XSS_FLAG]).toBe(
        undefined,
      );
    },
  );
});

describe('lo peligroso se elimina', () => {
  it('script, también partido o dentro de comentarios, desaparece con su contenido', () => {
    const payloads = [
      '<script>window.__xss=1</script>\n\ntexto',
      '<scr<script>ipt>window.__xss=1</scr</script>ipt>',
      '<!--><script>window.__xss=1</script>-->',
      '<template><script>window.__xss=1</script></template>',
    ];
    payloads.forEach((markdown) => {
      const root = render(markdown);
      expect(root.querySelector('script, template')).toBeNull();
      expect(root.innerHTML).not.toContain(XSS_FLAG);
    });
  });

  it('onerror y demás manejadores de eventos se quitan y la imagen sobrevive confinada', () => {
    const root = render('<img src="x" onerror="window.__xss=1" alt="a">');
    const image = root.querySelector('img');
    expect(image?.getAttributeNames().sort()).toEqual(['alt', 'src']);
    expect(image?.getAttribute('src')).toBe(
      `${WORKSPACE_FILE_ORIGIN}/wc/docs/x`,
    );
    expect(root.innerHTML).not.toContain(XSS_FLAG);
  });

  it('onclick, onfocus, autofocus y ontoggle se quitan del resto de etiquetas', () => {
    const root = render(
      '<p onclick="a()" onfocus="b()" autofocus ontoggle="c()">x</p><details open ontoggle="d()"><summary>s</summary></details>',
    );
    expect(root.innerHTML).not.toMatch(/on\w+=|autofocus/i);
    expect(root.querySelector('p')?.textContent).toBe('x');
  });

  it.each([
    '[x](javascript:window.__xss=1)',
    '[x](&#106;avascript:window.__xss=1)',
    '<a href="jav&#x09;ascript:window.__xss=1">x</a>',
    '<a href="  javascript:window.__xss=1">x</a>',
    '<a href="vbscript:window.__xss=1">x</a>',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  ])('el enlace %s pierde su destino ejecutable', (markdown) => {
    const root = render(markdown);
    expect(root.querySelector('a')?.textContent).toBe('x');
    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(root.innerHTML).not.toMatch(/javascript:|vbscript:|data:text/i);
  });

  it.each([
    ['svg con onload', '<svg onload=window.__xss=1></svg>'],
    ['svg con script', '<svg><script>window.__xss=1</script><rect/></svg>'],
    [
      'svg con foreignObject',
      '<svg><foreignObject><img src=x onerror=window.__xss=1></foreignObject></svg>',
    ],
    [
      'mXSS con math y style',
      '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=window.__xss=1&gt;">',
    ],
    [
      'mXSS con noscript',
      '<noscript><p title="</noscript><img src=x onerror=window.__xss=1>">',
    ],
  ])(
    '%s: no queda svg, math, foreignObject ni manejadores',
    (_name, markdown) => {
      const root = render(markdown);
      expect(
        root.querySelector(
          'svg, math, foreignObject, mglyph, noscript, script',
        ),
      ).toBeNull();
      expect(root.querySelector('img[onerror]')).toBeNull();
      expect(root.innerHTML).not.toMatch(/onerror=/i);
    },
  );

  it.each([
    '<iframe src="http://evil.test/x"></iframe>',
    '<iframe srcdoc="<script>window.__xss=1</script>"></iframe>',
    '<object data="http://evil.test/x"></object><embed src="http://evil.test/x">',
  ])('%s no deja iframe, object ni embed', (markdown) => {
    const root = render(markdown);
    expect(root.querySelector('iframe, object, embed')).toBeNull();
    expect(root.innerHTML).not.toContain('evil.test');
  });

  it.each([
    "<style>@import 'http://evil.test/x.css';</style>texto",
    '<p style="background:url(http://evil.test/x.png)">x</p>',
    '<link rel="stylesheet" href="http://evil.test/x.css">',
  ])('%s no deja style ni link ni atributo style', (markdown) => {
    const root = render(markdown);
    expect(root.querySelector('style, link, [style]')).toBeNull();
    expect(root.innerHTML).not.toContain('evil.test');
  });

  it('base, meta y formularios desaparecen y no cambian el destino de las imágenes', () => {
    const root = render(
      '<base href="http://evil.test/"><meta http-equiv="refresh" content="0;url=http://evil.test"><form action="http://evil.test"><input name="a"><button formaction="http://evil.test">ir</button></form>\n\n![x](a.png)',
    );
    expect(root.querySelector('base, meta, form, input, button')).toBeNull();
    expect(root.querySelector('img')?.getAttribute('src')).toBe(
      `${WORKSPACE_FILE_ORIGIN}/wc/docs/a.png`,
    );
  });

  it('data-*, aria-*, role, id, name y class de usuario se quitan', () => {
    const root = render(
      '<p data-x="1" aria-label="x" role="alert" id="i" name="n" class="c">x</p>',
    );
    expect(root.querySelector('p')?.getAttributeNames()).toEqual([]);
  });

  it('un span de usuario con class no sobrevive a la segunda pasada, solo su texto', () => {
    const root = render('<span class="x" onclick="a()">hola</span>');
    expect(root.querySelector('span')).toBeNull();
    expect(root.textContent).toContain('hola');
  });

  it('un span de usuario con la clase del aviso tampoco sobrevive', () => {
    const root = render(
      `<span class="${BLOCKED_IMAGE_CLASS}">falso aviso</span>`,
    );
    expect(root.querySelector('span')).toBeNull();
  });
});

describe('lo legítimo sobrevive', () => {
  it('una tabla conserva table, thead, tbody, th y td', () => {
    const root = render('| a | b |\n|---|:-:|\n| 1 | 2 |\n');
    const found = ['table', 'thead', 'tbody', 'tr', 'th', 'td'];
    expect(found.filter((tag) => !root.querySelector(tag))).toEqual([]);
    expect(root.querySelectorAll('td')).toHaveLength(2);
    expect(root.querySelector('td')?.textContent).toBe('1');
  });

  it('colspan, rowspan y align de una tabla en HTML se conservan', () => {
    const root = render(
      '<table><tr><td colspan="2" rowspan="3" align="center">x</td></tr></table>',
    );
    const cell = root.querySelector('td');
    expect(cell?.getAttribute('colspan')).toBe('2');
    expect(cell?.getAttribute('rowspan')).toBe('3');
    expect(cell?.getAttribute('align')).toBe('center');
  });

  it('listas ordenadas y no ordenadas conservan sus li y el atributo start', () => {
    const root = render('- uno\n- dos\n\n3. tres\n4. cuatro\n');
    expect(root.querySelectorAll('ul > li')).toHaveLength(2);
    expect(root.querySelectorAll('ol > li')).toHaveLength(2);
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
  });

  it('una imagen relativa conserva alt y title y apunta al protocolo', () => {
    const image = render('![logo](logo.png "pie")').querySelector('img');
    expect(image?.getAttributeNames().sort()).toEqual(['alt', 'src', 'title']);
    expect(image?.getAttribute('alt')).toBe('logo');
    expect(image?.getAttribute('title')).toBe('pie');
    expect(image?.getAttribute('src')).toBe(
      `${WORKSPACE_FILE_ORIGIN}/wc/docs/logo.png`,
    );
  });

  it('énfasis, código, citas y encabezados se conservan', () => {
    const root = render('# T\n\n**n** *c* `k`\n\n> cita\n\n```\nbloque\n```\n');
    const found = ['h1', 'strong', 'em', 'code', 'blockquote', 'pre'];
    expect(found.filter((tag) => !root.querySelector(tag))).toEqual([]);
  });
});

describe('la segunda pasada con ADD_TAGS y ADD_ATTR como función', () => {
  it('el aviso de imagen bloqueada llega al DOM como span con su clase', () => {
    const root = render('![mi foto](http://evil.test/a.png)');
    const notice = root.querySelector(`span.${BLOCKED_IMAGE_CLASS}`);
    expect(notice?.getAttributeNames()).toEqual(['class']);
    expect(notice?.textContent).toContain('mi foto');
    expect(root.querySelector('img')).toBeNull();
  });

  it('cada imagen bloqueada deja su propio aviso', () => {
    const root = render('![a](http://evil.test/1.png) ![b](//evil.test/2.png)');
    expect(root.querySelectorAll(`span.${BLOCKED_IMAGE_CLASS}`)).toHaveLength(
      2,
    );
  });

  it('el aviso no arrastra ninguna dirección remota', () => {
    const root = render('![x](http://evil.test/a.png)');
    expect(root.innerHTML).not.toContain('evil.test');
  });
});
