import { describe, expect, it } from 'vitest';

const ALLOWED_VHTML_FILE = 'src/components/documents/MarkdownPreview.vue';
const HTML_SINKS =
  /v-html|\.innerHTML\s*\+?=|\.outerHTML\s*\+?=|insertAdjacent(?:HTML|Element)|createContextualFragment|DOMParser|parseFromString|setHTMLUnsafe|document\.write(?:ln)?\(/;
const IS_TEST_FILE = /\.test\.ts$/;

const sources = import.meta.glob<string>(
  ['/src/**/*.{vue,ts}', '!/src/**/*.test.ts'],
  { query: '?raw', import: 'default', eager: true },
);

function filesWithHtmlSinks(): string[] {
  return Object.entries(sources)
    .filter(([path]) => !IS_TEST_FILE.test(path))
    .filter(([, content]) => HTML_SINKS.test(content))
    .map(([path]) => path.replace(/^\//, ''));
}

const SINK_SAMPLES = [
  '<div v-html="x" />',
  'el.innerHTML = x',
  'el.innerHTML += x',
  'el.outerHTML = x',
  'el.insertAdjacentHTML("beforeend", x)',
  'el.insertAdjacentElement("beforeend", x)',
  'range.createContextualFragment(x)',
  'new DOMParser()',
  'parser.parseFromString(x, "text/html")',
  'el.setHTMLUnsafe(x)',
  'document.write(x)',
  'document.writeln(x)',
];

describe('detector de sumideros', () => {
  it.each(SINK_SAMPLES)('reconoce %s', (sample) => {
    expect(HTML_SINKS.test(sample)).toBe(true);
  });

  it('no marca la lectura de innerHTML', () => {
    expect(HTML_SINKS.test('const html = holder.innerHTML;')).toBe(false);
  });
});

describe('inserción de HTML', () => {
  it('encuentra los archivos de src para auditar', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(Object.keys(sources)).toContain('/' + ALLOWED_VHTML_FILE);
  });

  it('solo MarkdownPreview.vue usa v-html', () => {
    const withVHtml = Object.entries(sources)
      .filter(([, content]) => content.includes('v-html'))
      .map(([path]) => path.replace(/^\//, ''));
    expect(withVHtml).toEqual([ALLOWED_VHTML_FILE]);
  });

  it('ningún otro archivo escribe HTML en el DOM', () => {
    const offenders = filesWithHtmlSinks().filter(
      (path) => path !== ALLOWED_VHTML_FILE,
    );
    expect(offenders).toEqual([]);
  });
});
