export interface AuditPolicy {
  tags: string[];
  attributes: string[];
  workspaceOrigin: string;
  blockedClass: string;
}

export interface ElementSnapshot {
  tag: string;
  attributes: Record<string, string>;
}

export function snapshotDom(selector: string): ElementSnapshot[] {
  const elements = document.querySelector(selector)?.querySelectorAll('*');
  return Array.from(elements ?? [], (element) => ({
    tag: element.tagName.toLowerCase(),
    attributes: Object.fromEntries(
      element
        .getAttributeNames()
        .map((name) => [name, element.getAttribute(name) ?? '']),
    ),
  }));
}

function isPlaceholder(element: ElementSnapshot, policy: AuditPolicy) {
  return (
    element.tag === 'span' && element.attributes.class === policy.blockedClass
  );
}

function tagViolations(element: ElementSnapshot, policy: AuditPolicy) {
  const isAllowed =
    policy.tags.includes(element.tag) || isPlaceholder(element, policy);
  return isAllowed ? [] : [`etiqueta ${element.tag}`];
}

function attributeViolations(element: ElementSnapshot, policy: AuditPolicy) {
  const isClassOfPlaceholder = (name: string) =>
    name === 'class' && isPlaceholder(element, policy);
  return Object.keys(element.attributes)
    .filter(
      (name) =>
        !policy.attributes.includes(name) && !isClassOfPlaceholder(name),
    )
    .map((name) => `atributo ${name} en ${element.tag}`);
}

function targetViolations(element: ElementSnapshot, policy: AuditPolicy) {
  const { src, href } = element.attributes;
  const isLocalImage = src?.startsWith(`${policy.workspaceOrigin}/`);
  if (element.tag === 'img' && !isLocalImage) {
    return [`imagen fuera del protocolo: ${src}`];
  }
  return element.tag === 'a' && href !== undefined ? ['enlace con href'] : [];
}

export function auditSnapshot(
  elements: ElementSnapshot[],
  policy: AuditPolicy,
): string[] {
  return elements.flatMap((element) => [
    ...tagViolations(element, policy),
    ...attributeViolations(element, policy),
    ...targetViolations(element, policy),
  ]);
}
