export interface XssPayload {
  name: string;
  markdown: string;
}

export const XSS_FLAG = '__xss';
export const EVIL_HOST = 'evil.test';

const FLAG = `window.${XSS_FLAG}=1`;
const EVIL_URL = `http://${EVIL_HOST}/x`;
const NESTING_DEPTH = 600;

export const XSS_CORPUS: readonly XssPayload[] = [
  { name: 'script', markdown: `<script>${FLAG}</script>\n\ntexto` },
  {
    name: 'script disfrazado',
    markdown: `<scr<script>ipt>${FLAG}</scr</script>ipt>`,
  },
  { name: 'enlace javascript', markdown: `[pulsa](javascript:${FLAG})` },
  {
    name: 'enlace javascript con entidades',
    markdown: `[pulsa](&#106;avascript:${FLAG})`,
  },
  {
    name: 'enlace javascript con tabulador',
    markdown: `<a href="jav&#x09;ascript:${FLAG}">x</a>`,
  },
  {
    name: 'enlace javascript con espacios',
    markdown: `<a href="  javascript:${FLAG}">x</a>`,
  },
  { name: 'enlace vbscript', markdown: `<a href="vbscript:${FLAG}">x</a>` },
  {
    name: 'enlace data html',
    markdown: '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  },
  { name: 'autoenlace javascript', markdown: `<javascript:${FLAG}>` },
  {
    name: 'enlace por referencia',
    markdown: `[x][r]\n\n[r]: javascript:${FLAG}`,
  },
  { name: 'imagen onerror', markdown: `<img src=x onerror=${FLAG}>` },
  {
    name: 'imagen onerror desde markdown',
    markdown: `![a](x" onerror="${FLAG})`,
  },
  {
    name: 'imagen con esquema roto',
    markdown: `<img src=x:alert onerror=${FLAG}>`,
  },
  {
    name: 'imagen data svg',
    markdown: '![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)',
  },
  {
    name: 'imagen srcset',
    markdown: `<img srcset="${EVIL_URL}.png 1x" src="a.png">`,
  },
  {
    name: 'picture con source',
    markdown: `<picture><source srcset="${EVIL_URL}.png"><img src="a.png"></picture>`,
  },
  { name: 'svg onload', markdown: `<svg onload=${FLAG}></svg>` },
  {
    name: 'svg con script',
    markdown: `<svg><script>${FLAG}</script><rect/></svg>`,
  },
  {
    name: 'svg con enlace xlink',
    markdown: `<svg><a xlink:href="javascript:${FLAG}"><text y="9">x</text></a></svg>`,
  },
  {
    name: 'svg con foreignObject',
    markdown: `<svg><foreignObject><img src=x onerror=${FLAG}></foreignObject></svg>`,
  },
  {
    name: 'math mXSS',
    markdown: `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=${FLAG}&gt;">`,
  },
  {
    name: 'noscript mXSS',
    markdown: `<noscript><p title="</noscript><img src=x onerror=${FLAG}>">`,
  },
  {
    name: 'anidamiento de formularios',
    markdown: `<form><math><mtext></form><form><mglyph><style></math><img src onerror=${FLAG}>`,
  },
  {
    name: 'iframe srcdoc',
    markdown: `<iframe srcdoc="<script>${FLAG}</script>"></iframe>`,
  },
  { name: 'iframe externo', markdown: `<iframe src="${EVIL_URL}"></iframe>` },
  {
    name: 'object y embed',
    markdown: `<object data="${EVIL_URL}"></object><embed src="${EVIL_URL}">`,
  },
  {
    name: 'object data html',
    markdown:
      '<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>',
  },
  {
    name: 'style con import',
    markdown: `<style>@import '${EVIL_URL}.css';</style>texto`,
  },
  {
    name: 'atributo style',
    markdown: `<p style="background:url(${EVIL_URL}.png)">x</p>`,
  },
  {
    name: 'enlace a hoja de estilos',
    markdown: `<link rel="stylesheet" href="${EVIL_URL}.css">`,
  },
  { name: 'base', markdown: `<base href="${EVIL_URL}/">\n\n![x](a.png)` },
  {
    name: 'base partida por otra anidada',
    markdown: `<div><ba<base>se href="${EVIL_URL}/">\n\n![x](a.png)`,
  },
  {
    name: 'meta refresh',
    markdown: `<meta http-equiv="refresh" content="0;url=${EVIL_URL}">`,
  },
  {
    name: 'formulario con botón',
    markdown: `<form action="${EVIL_URL}"><input name="a"><button formaction="${EVIL_URL}">ir</button></form>`,
  },
  {
    name: 'atributos data',
    markdown: `<p data-x="1" data-evil="${FLAG}">x</p>`,
  },
  {
    name: 'atributos aria',
    markdown: '<p aria-label="x" aria-hidden="true" role="alert">x</p>',
  },
  {
    name: 'manejadores de eventos',
    markdown: `<a href="#" onclick="${FLAG}" onfocus="${FLAG}" autofocus>x</a>`,
  },
  {
    name: 'details ontoggle',
    markdown: `<details open ontoggle="${FLAG}"><summary>x</summary></details>`,
  },
  {
    name: 'audio y video',
    markdown: `<video src="${EVIL_URL}.mp4" onerror="${FLAG}"></video><audio src="${EVIL_URL}.mp3" autoplay></audio>`,
  },
  {
    name: 'textarea con etiquetas',
    markdown: `<textarea><img src=x onerror=${FLAG}></textarea>`,
  },
  {
    name: 'template con script',
    markdown: `<template><script>${FLAG}</script></template>`,
  },
  {
    name: 'comentario condicional',
    markdown: `<!--[if IE]><script>${FLAG}</script><![endif]-->texto`,
  },
  {
    name: 'comentario que se cierra mal',
    markdown: `<!--><script>${FLAG}</script>-->`,
  },
  {
    name: 'clobbering del DOM',
    markdown:
      '<form id="x"><input name="attributes"></form><img name="getElementById" id="cookie">',
  },
  { name: 'marquee', markdown: `<marquee onstart="${FLAG}">x</marquee>` },
  {
    name: 'body y html',
    markdown: `<html><body onload="${FLAG}">x</body></html>`,
  },
  {
    name: 'fondo de tabla',
    markdown: `<table background="javascript:${FLAG}"><tr><td background="${EVIL_URL}">x</td></tr></table>`,
  },
  { name: 'imagen remota', markdown: `![remota](${EVIL_URL}.png)` },
  {
    name: 'imagen remota https',
    markdown: `![remota](https://${EVIL_HOST}/p.png)`,
  },
  { name: 'imagen sin esquema', markdown: `![remota](//${EVIL_HOST}/p.png)` },
  { name: 'imagen file', markdown: '![local](file:///C:/Windows/win.ini)' },
  { name: 'imagen UNC', markdown: `![red](\\\\${EVIL_HOST}\\recurso\\a.png)` },
  {
    name: 'imagen con ruta absoluta de Windows',
    markdown: '![abs](C:\\Windows\\Web\\a.png)',
  },
  { name: 'imagen con ruta absoluta', markdown: '![abs](/Windows/a.png)' },
  {
    name: 'imagen que escapa del root',
    markdown: '![fuera](../../../../../../../../../../secreto.png)',
  },
  {
    name: 'imagen que escapa codificada',
    markdown:
      '![fuera](%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/secreto.png)',
  },
  { name: 'imagen con flujo alterno', markdown: '![ads](imagen.png:flujo)' },
  { name: 'anidamiento profundo', markdown: '<b>'.repeat(NESTING_DEPTH) + 'x' },
];
