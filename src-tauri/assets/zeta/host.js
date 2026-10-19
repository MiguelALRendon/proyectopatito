'use strict';

const INIT_TYPE = 'dakedaduck-office-init';
const CHUNK_BYTES = 8 * 1024 * 1024;
const OFFICE_DIR = '/tmp/office';
const FIT_DELAY_MS = 150;
const FIT_MARGIN_PX = 2;
const BIG_FILES = ['soffice.wasm', 'soffice.data'];
const FORMATS = [
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'doc',
  'xls',
  'ppt',
];

let pagePort = null;
let zetaPort = null;
let current = null;
let fitTimer = 0;

function send(message, transfer = []) {
  pagePort.postMessage(message, transfer);
}

function fail(code, detail, extra) {
  send({ cmd: 'error', code, detail: String(detail || ''), ...extra });
}

async function fetchRange(name, start) {
  const end = start + CHUNK_BYTES - 1;
  const response = await fetch(name, {
    headers: { Range: `bytes=${start}-${end}` },
  });
  if (response.status !== 206) throw new Error(`${name}: ${response.status}`);
  const total = Number(response.headers.get('content-range').split('/')[1]);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || !Number.isFinite(total)) {
    throw new Error(`${name}: respuesta vacía`);
  }
  return { name, bytes, total };
}

async function readRest(first, tick) {
  const out = new Uint8Array(first.total);
  out.set(first.bytes);
  tick(first.bytes.length);
  for (let at = first.bytes.length; at < first.total; ) {
    const part = await fetchRange(first.name, at);
    out.set(part.bytes, at);
    at += part.bytes.length;
    tick(part.bytes.length);
  }
  return out.buffer;
}

async function download(names) {
  const firsts = await Promise.all(names.map((name) => fetchRange(name, 0)));
  const total = firsts.reduce((sum, first) => sum + first.total, 0);
  let loaded = 0;
  const tick = (bytes) => {
    loaded += bytes;
    send({ cmd: 'progress', loaded, total });
  };
  return Promise.all(firsts.map((first) => readRest(first, tick)));
}

function absolute(name) {
  return new URL(name, location.href).href;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`${src} no cargó`));
    document.body.appendChild(script);
  });
}

async function hasTestHooks() {
  const response = await fetch('office_test.js', { method: 'HEAD' });
  return response.ok;
}

async function boot() {
  const withHooks = await hasTestHooks();
  const [wasm, data] = await download(BIG_FILES);
  const scripts = ['zeta.js', 'office_thread.js'];
  if (withHooks) scripts.push('office_test_thread.js');
  window.Module = {
    canvas: document.getElementById('qtcanvas'),
    uno_scripts: scripts.map(absolute),
    wasmBinary: wasm,
    getPreloadedPackage: (name) =>
      name.endsWith('soffice.data') ? data : null,
  };
  await loadScript(absolute('soffice.js'));
  zetaPort = await window.Module.uno_main;
  zetaPort.onmessage = onWorkerMessage;
  if (withHooks) await loadScript(absolute('office_test.js'));
}

function startOpen(message) {
  const known = FORMATS.includes(message.ext);
  const valid = known && message.bytes instanceof ArrayBuffer;
  if (!valid || !message.bytes.byteLength) {
    return fail('invalid-message', `open: ext=${message.ext} bytes=${message.bytes && message.bytes.byteLength}`, {
      docId: message.docId,
    });
  }
  if (current) {
    return fail('busy', `open: ya abierto ${current.state}`, { docId: message.docId });
  }
  const name = `${crypto.randomUUID()}.${message.ext}`;
  FS.mkdirTree(OFFICE_DIR);
  FS.writeFile(`${OFFICE_DIR}/${name}`, new Uint8Array(message.bytes));
  current = { docId: message.docId, name, state: 'opening' };
  zetaPort.postMessage({ cmd: 'open', name });
}

function startSave(message) {
  const isMine = current && current.docId === message.docId;
  if (!isMine || current.state !== 'open') {
    return fail('invalid-message', 'save', { docId: message.docId });
  }
  current.state = 'saving';
  zetaPort.postMessage({ cmd: 'save' });
}

function startClose(message) {
  if (!current || current.docId !== message.docId) {
    return send({ cmd: 'closed', docId: message.docId });
  }
  zetaPort.postMessage({ cmd: 'close' });
}

function discardCurrent() {
  if (!current) return;
  try {
    FS.unlink(`${OFFICE_DIR}/${current.name}`);
  } catch {
    // el archivo ya no estaba: no hay nada que borrar
  }
  current = null;
}

function fit() {
  if (!current) return;
  zetaPort.postMessage({
    cmd: 'fit',
    w: innerWidth - FIT_MARGIN_PX,
    h: innerHeight,
  });
}

function readStored() {
  const data = FS.readFile(`${OFFICE_DIR}/${current.name}`);
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

const workerEvents = {
  opened(message) {
    current.state = 'open';
    send({ cmd: 'opened', docId: current.docId, kind: message.kind });
    fit();
  },
  stored(message) {
    const bytes = readStored();
    current.state = 'open';
    const saved = { cmd: 'saved', docId: current.docId };
    send({ ...saved, requested: message.requested, bytes }, [bytes]);
  },
  closed() {
    const docId = current.docId;
    discardCurrent();
    send({ cmd: 'closed', docId });
  },
  failed(message) {
    const { docId, state } = current;
    if (state !== 'opening') {
      current.state = 'open';
      return fail('save-failed', message.detail, { docId });
    }
    discardCurrent();
    fail('open-failed', message.detail, { docId });
  },
  modified: () => send({ cmd: 'modified', docId: current.docId }),
  blocked: (message) => send({ cmd: 'blocked', command: message.command }),
  'save-requested': () =>
    send({ cmd: 'save-requested', docId: current.docId }),
};

function onWorkerMessage(event) {
  const handler = Object.hasOwn(workerEvents, event.data.cmd)
    ? workerEvents[event.data.cmd]
    : null;
  if (handler && current) handler(event.data);
}

const pageCommands = { open: startOpen, save: startSave, close: startClose };

function onPageMessage(event) {
  const message = event.data;
  const known = message && Object.hasOwn(pageCommands, message.cmd);
  if (!known) return fail('invalid-message', message && message.cmd);
  pageCommands[message.cmd](message);
}

function accept(event) {
  const isInit = event.data && event.data.type === INIT_TYPE;
  if (pagePort || event.source !== window.parent || !isInit) return;
  if (event.ports.length !== 1) return;
  pagePort = event.ports[0];
  pagePort.onmessage = onPageMessage;
  boot().then(
    () => send({ cmd: 'ready' }),
    (error) => fail('boot-failed', error && error.message),
  );
}

window.addEventListener('message', accept);
window.addEventListener('resize', () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(fit, FIT_DELAY_MS);
});
const canvas = document.getElementById('qtcanvas');
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', () => window.focus());
