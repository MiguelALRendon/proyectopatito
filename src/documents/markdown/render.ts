import DOMPurify, { type Config } from 'dompurify';
import { marked } from 'marked';
import { BLOCKED_IMAGE_LABEL, LINK_INERT_LABEL } from '../labels';
import { classifyImage } from './relativeUrl';

// El parseo inerte de DOMPurify hereda la CSP y un <base href> externo violaría base-uri aunque se descarte
const BASE_TAG_START = /<base\b/gi;
const ESCAPED_BASE_TAG = '&lt;base';
const PLACEHOLDER_TAG = 'span';
const PLACEHOLDER_ATTRIBUTE = 'class';

export const BLOCKED_IMAGE_CLASS = 'markdown-preview__blocked';

export const ALLOWED_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'kbd',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
];

export const ALLOWED_ATTR = [
  'align',
  'alt',
  'colspan',
  'href',
  'rowspan',
  'src',
  'start',
  'title',
];

export const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

const SANITIZER_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOWED_URI_REGEXP,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  FORBID_TAGS: ['base'],
  RETURN_DOM_FRAGMENT: true,
} as const satisfies Config;

const SECOND_PASS_CONFIG = {
  ...SANITIZER_CONFIG,
  ADD_TAGS: (tag: string) => tag === PLACEHOLDER_TAG,
  ADD_ATTR: (attribute: string, tag: string) =>
    tag === PLACEHOLDER_TAG && attribute === PLACEHOLDER_ATTRIBUTE,
  RETURN_DOM_FRAGMENT: false,
} as const satisfies Config;

export function imagePlaceholder(
  image: HTMLImageElement,
  label: string,
): HTMLElement {
  const placeholder = image.ownerDocument.createElement('span');
  const description = image.getAttribute('alt');
  placeholder.className = BLOCKED_IMAGE_CLASS;
  placeholder.textContent = description ? `${label}: ${description}` : label;
  return placeholder;
}

function confineImage(image: HTMLImageElement, baseDirectory: string) {
  const source = classifyImage(image.getAttribute('src') ?? '', baseDirectory);
  if (source.kind === 'blocked')
    image.replaceWith(imagePlaceholder(image, BLOCKED_IMAGE_LABEL));
  else image.setAttribute('src', source.url);
}

function silenceLink(link: HTMLAnchorElement) {
  const destination = link.getAttribute('href');
  link.removeAttribute('href');
  if (destination) {
    link.setAttribute('title', `${LINK_INERT_LABEL}: ${destination}`);
  }
}

export function neutralizeBaseTags(html: string): string {
  return html.replace(BASE_TAG_START, ESCAPED_BASE_TAG);
}

function confineFragment(fragment: DocumentFragment, baseDirectory: string) {
  fragment
    .querySelectorAll('img')
    .forEach((image) => confineImage(image, baseDirectory));
  fragment.querySelectorAll('a').forEach(silenceLink);
}

export function renderMarkdown(source: string, baseDirectory: string): string {
  const html = neutralizeBaseTags(marked.parse(source, { async: false }));
  const fragment = DOMPurify.sanitize(html, SANITIZER_CONFIG);
  confineFragment(fragment, baseDirectory);
  const holder = document.createElement('div');
  holder.append(fragment);
  return DOMPurify.sanitize(holder.innerHTML, SECOND_PASS_CONFIG);
}
