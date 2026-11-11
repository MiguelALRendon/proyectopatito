const ALL_NODE_TYPES = 0xffffffff;

function followingNode(node: Node, root: Node): Node | null {
  if (node.firstChild) return node.firstChild;
  for (let up: Node | null = node; up && up !== root; up = up.parentNode) {
    if (up.nextSibling) return up.nextSibling;
  }
  return null;
}

function precedingNode(node: Node, root: Node): Node | null {
  if (node === root) return null;
  let last = node.previousSibling;
  if (!last) return node.parentNode;
  while (last.lastChild) last = last.lastChild;
  return last;
}

function isShown(node: Node, whatToShow: number): boolean {
  return (whatToShow & (1 << (node.nodeType - 1))) !== 0;
}

function createSpecNodeIterator(root: Node, whatToShow = ALL_NODE_TYPES) {
  let last: Node | null = null;
  let before: Node | null = null;
  const advance = (): Node | null => {
    if (!last) return root;
    const from = root.contains(last) ? last : before;
    return from && followingNode(from, root);
  };
  return {
    nextNode(): Node | null {
      let candidate = advance();
      while (candidate && !isShown(candidate, whatToShow)) {
        candidate = followingNode(candidate, root);
      }
      if (candidate) {
        last = candidate;
        before = precedingNode(candidate, root);
      }
      return candidate;
    },
  };
}

function subclassAwareNodeName(original: PropertyDescriptor) {
  return function nodeName(this: Node): string {
    let proto: object | null = Object.getPrototypeOf(this);
    while (proto && proto !== Node.prototype) {
      const own = Object.getOwnPropertyDescriptor(proto, 'nodeName');
      if (own?.get) return own.get.call(this);
      proto = Object.getPrototypeOf(proto);
    }
    return original.get?.call(this) ?? '';
  };
}

function installHappyDomPurifyShim(): void {
  const original = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeName')!;
  Object.defineProperty(Node.prototype, 'nodeName', {
    ...original,
    get: subclassAwareNodeName(original),
  });
  for (let proto = Object.getPrototypeOf(document); proto;) {
    if (Object.prototype.hasOwnProperty.call(proto, 'createNodeIterator')) {
      proto.createNodeIterator = createSpecNodeIterator;
    }
    proto = Object.getPrototypeOf(proto);
  }
}

installHappyDomPurifyShim();
