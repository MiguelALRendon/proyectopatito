import { describe, expect, it } from 'vitest';
import {
  auditSnapshot,
  snapshotDom,
  type AuditPolicy,
  type ElementSnapshot,
} from './xssAudit';

const ORIGIN = 'http://workspace-file.localhost';
const POLICY: AuditPolicy = {
  tags: ['p', 'img', 'a'],
  attributes: ['src', 'alt', 'href'],
  workspaceOrigin: ORIGIN,
  blockedClass: 'blocked',
};

function element(
  tag: string,
  attributes: Record<string, string> = {},
): ElementSnapshot {
  return { tag, attributes };
}

describe('auditSnapshot', () => {
  it('señala una etiqueta fuera de la lista', () => {
    expect(auditSnapshot([element('script')], POLICY)).toEqual([
      'etiqueta script',
    ]);
  });

  it('señala un atributo fuera de la lista', () => {
    expect(auditSnapshot([element('p', { onclick: 'x' })], POLICY)).toEqual([
      'atributo onclick en p',
    ]);
  });

  it('señala una imagen que no viene del protocolo', () => {
    const remote = element('img', { src: 'http://evil.test/a.png' });
    expect(auditSnapshot([remote], POLICY)).toHaveLength(1);
    expect(auditSnapshot([element('img')], POLICY)).toHaveLength(1);
  });

  it('señala un origen que solo empieza igual', () => {
    const lookalike = element('img', { src: `${ORIGIN}.evil.test/a.png` });
    expect(auditSnapshot([lookalike], POLICY)).toHaveLength(1);
  });

  it('señala un enlace con href', () => {
    expect(auditSnapshot([element('a', { href: '#' })], POLICY)).toEqual([
      'enlace con href',
    ]);
  });

  it('acepta el aviso de imagen bloqueada con su clase', () => {
    const notice = element('span', { class: 'blocked' });
    expect(auditSnapshot([notice], POLICY)).toEqual([]);
  });

  it('un span cualquiera o con otra clase no es el aviso', () => {
    expect(auditSnapshot([element('span')], POLICY)).toHaveLength(1);
    const other = element('span', { class: 'otra' });
    expect(auditSnapshot([other], POLICY)).toHaveLength(2);
  });

  it('una clase fuera del aviso no está permitida', () => {
    expect(auditSnapshot([element('p', { class: 'blocked' })], POLICY)).toEqual(
      ['atributo class en p'],
    );
  });

  it('un documento limpio no tiene hallazgos', () => {
    const clean = [element('p'), element('img', { src: `${ORIGIN}/a.png` })];
    expect(auditSnapshot(clean, POLICY)).toEqual([]);
  });
});

describe('snapshotDom', () => {
  it('describe cada descendiente con sus atributos', () => {
    document.body.innerHTML =
      '<article id="raiz"><p title="t"><img src="a.png"></p></article>';
    expect(snapshotDom('#raiz')).toEqual([
      { tag: 'p', attributes: { title: 't' } },
      { tag: 'img', attributes: { src: 'a.png' } },
    ]);
  });

  it('sin la raíz no describe nada', () => {
    document.body.innerHTML = '';
    expect(snapshotDom('#no-existe')).toEqual([]);
  });
});
