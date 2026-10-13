import type {
  CommandError,
  ErrorKind,
  InfoEntry,
  OperationResult,
  ProgressEvent,
  StatusEntry,
  SvnDetection,
} from '../../../src/services/tauri';

type Listener = (event: {
  event: string;
  id: number;
  payload: unknown;
}) => void;
type Args = Record<string, unknown> | undefined;
type OperationKind = 'checkout' | 'update' | 'commit' | 'cleanup';

interface MockWorkingCopy {
  url: string;
  revision: number;
  isLocked: boolean;
  status: StatusEntry[];
}

interface MockState {
  workspace: string | null;
  svnVersion: string | null;
  svnError: string;
  wcs: Record<string, MockWorkingCopy>;
  nextError: ErrorKind | null;
  nextDirectory: string;
  stepDelayMs: number;
  emitBeforeReturn: boolean;
  calls: { command: string; args: Args }[];
  lastUsername: string | null;
  didReceivePassword: boolean;
}

interface RunningOperation {
  kind: OperationKind;
  path: string;
  isCancelled: boolean;
}

const MOCK_SVN_PATH = 'C:/mock/svn.exe';
const DEFAULT_SVN_VERSION = '1.14.2';
const OLD_SVN_MESSAGE =
  'svn 1.9.7 en C:/mock/svn.exe es anterior a la mínima requerida 1.10.0';
const ABSENT_SVN_MESSAGE = 'No se encontró svn.exe en el PATH.';
const DEFAULT_DIRECTORY = 'C:/mock-workspace';
const DEFAULT_STEP_DELAY_MS = 40;
const DEMO_WC_NAME = 'demo-wc';
const DEMO_REPO_URL = 'https://svn.example.test/demo/trunk';
const CHECKOUT_FILES = ['README.txt', 'src/main.c', 'src/util.c'];

const ERROR_MESSAGES: Record<ErrorKind, string> = {
  no_workspace: 'No hay Workspace Root configurado.',
  no_svn: 'No se encontró Subversion.',
  outside_workspace: 'La ruta queda fuera del Workspace Root.',
  destination_exists: 'El destino ya existe.',
  invalid_path: 'La ruta no es válida.',
  auth_required: 'El servidor requiere autenticación (E170001).',
  untrusted_certificate:
    'Certificado del servidor no confiable (E230001): acéptalo con otro cliente.',
  working_copy_too_old:
    'La copia de trabajo es de un formato antiguo (E155036): ejecuta svn upgrade con otro cliente.',
  working_copy_locked: 'La copia de trabajo está bloqueada (E155004).',
  cancelled: 'Operación cancelada.',
  timed_out: 'La operación excedió el tiempo límite.',
  svn_failed: 'svn terminó con error.',
  parse_failed: 'No se pudo interpretar la salida de svn.',
  io: 'Error de entrada/salida.',
};

const listeners = new Map<string, Set<Listener>>();
const running = new Map<number, RunningOperation>();
let lastOperationId = 0;

function initialSvnVersion(query: URLSearchParams): string | null {
  const mode = query.get('svn');
  if (mode === 'absent') return null;
  return mode === 'old' ? null : DEFAULT_SVN_VERSION;
}

function initialSvnError(query: URLSearchParams): string | null {
  return query.get('svn') === 'old' ? OLD_SVN_MESSAGE : ABSENT_SVN_MESSAGE;
}

function buildDemoWorkingCopy(): MockWorkingCopy {
  const entry = (path: string, item: string): StatusEntry => ({
    path,
    item,
    props: 'none',
    revision: 7,
    remote_item: null,
    remote_props: null,
  });
  return {
    url: DEMO_REPO_URL,
    revision: 7,
    isLocked: false,
    status: [
      entry('src/main.c', 'modified'),
      entry('notas.txt', 'unversioned'),
      entry('src/old.c', 'conflicted'),
    ],
  };
}

function createState(): MockState {
  const query = new URLSearchParams(window.location.search);
  return {
    workspace: query.get('root'),
    svnVersion: initialSvnVersion(query),
    svnError: initialSvnError(query),
    wcs: { [DEMO_WC_NAME]: buildDemoWorkingCopy() },
    nextError: null,
    nextDirectory: DEFAULT_DIRECTORY,
    stepDelayMs: DEFAULT_STEP_DELAY_MS,
    emitBeforeReturn: false,
    calls: [],
    lastUsername: null,
    didReceivePassword: false,
  };
}

export const state = createState();

function commandError(kind: ErrorKind, message?: string): CommandError {
  return {
    kind,
    message: message ?? ERROR_MESSAGES[kind],
    codes: [],
    detail: null,
  };
}

export function emit(event: string, payload: unknown) {
  listeners
    .get(event)
    ?.forEach((listener) => listener({ event, id: 0, payload }));
}

export function addListener(event: string, listener: Listener): () => void {
  const bucket = listeners.get(event) ?? new Set<Listener>();
  bucket.add(listener);
  listeners.set(event, bucket);
  return () => bucket.delete(listener);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function findWorkingCopy(path: string): MockWorkingCopy | null {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return (
    state.wcs[path] ?? state.wcs[segments[segments.length - 1] ?? ''] ?? null
  );
}

function requireWorkingCopy(path: string): MockWorkingCopy {
  const wc = findWorkingCopy(path);
  if (!wc)
    throw commandError(
      'svn_failed',
      `${path} no es una copia de trabajo (E155007).`,
    );
  return wc;
}

function detection(): SvnDetection {
  if (state.svnVersion === null) {
    return { binary: null, error: state.svnError };
  }
  return {
    binary: { path: MOCK_SVN_PATH, version: state.svnVersion },
    error: null,
  };
}

function setSvnPath(path: string): SvnDetection {
  if (!path.toLowerCase().includes('svn')) {
    return {
      binary: null,
      error: 'El archivo no es un ejecutable de Subversion.',
    };
  }
  state.svnVersion = state.svnVersion ?? DEFAULT_SVN_VERSION;
  return { binary: { path, version: state.svnVersion }, error: null };
}

function setWorkspace(path: string): string {
  const isInvalid = !path.trim() || path.toLowerCase().includes('invalid');
  if (isInvalid) throw commandError('invalid_path', `Ruta no válida: ${path}`);
  state.workspace = path;
  return path;
}

function infoFor(path: string): InfoEntry {
  const wc = requireWorkingCopy(path);
  return {
    path,
    kind: 'dir',
    revision: wc.revision,
    url: wc.url,
    relative_url: '^/trunk',
    repository_root: 'https://svn.example.test/demo',
    repository_uuid: '00000000-0000-0000-0000-000000000001',
    working_copy_root: path,
    last_changed_revision: wc.revision,
    last_changed_author: 'mock-user',
    last_changed_date: '2026-01-01T00:00:00.000000Z',
  };
}

function readOperationArgs(args: Args): Record<string, unknown> {
  return ((args?.req as Record<string, unknown> | undefined) ?? {}) as Record<
    string,
    unknown
  >;
}

function checkOperationError(
  req: Record<string, unknown>,
  wc: MockWorkingCopy | null,
): ErrorKind | null {
  const forced = state.nextError;
  if (forced === 'auth_required' && !req.password) return forced;
  if (forced && forced !== 'auth_required') {
    state.nextError = null;
    return forced;
  }
  if (forced === 'auth_required') state.nextError = null;
  return wc?.isLocked && req.kind !== 'cleanup' ? 'working_copy_locked' : null;
}

function applySuccess(kind: OperationKind, path: string): number {
  if (kind === 'checkout') {
    state.wcs[path] = {
      url: DEMO_REPO_URL,
      revision: 8,
      isLocked: false,
      status: [],
    };
    return 8;
  }
  const wc = requireWorkingCopy(path);
  if (kind === 'cleanup') wc.isLocked = false;
  if (kind === 'update') wc.revision += 1;
  if (kind === 'commit') {
    wc.revision += 1;
    wc.status = wc.status.filter((entry) => entry.item === 'unversioned');
  }
  return wc.revision;
}

function progressFor(kind: OperationKind): ProgressEvent[] {
  if (kind === 'cleanup') return [{ kind: 'other', data: 'Cleanup en curso' }];
  const files = CHECKOUT_FILES.map<ProgressEvent>((path) => ({
    kind: 'item',
    data: { action: kind === 'commit' ? 'sending' : 'added', path },
  }));
  return [...files, { kind: 'revision', data: { revision: 8 } }];
}

function failureResult(kind: ErrorKind): OperationResult {
  return { status: 'err', ...commandError(kind) };
}

async function finishOperation(
  id: number,
  req: Record<string, unknown>,
): Promise<void> {
  const op = running.get(id);
  if (!op) return;
  const wc = findWorkingCopy(op.path);
  for (const event of progressFor(op.kind)) {
    if (!state.emitBeforeReturn) await sleep(state.stepDelayMs);
    if (op.isCancelled) break;
    emit('svn://progress', { id, event });
  }
  running.delete(id);
  const result = resolveResult(op, req, wc);
  emit('svn://done', { id, result });
}

function resolveResult(
  op: RunningOperation,
  req: Record<string, unknown>,
  wc: MockWorkingCopy | null,
): OperationResult {
  if (op.isCancelled) return failureResult('cancelled');
  if (op.kind === 'checkout' && wc) return failureResult('destination_exists');
  const failure = checkOperationError({ ...req, kind: op.kind }, wc);
  if (failure) {
    if (failure === 'working_copy_locked' && wc) wc.isLocked = true;
    return failureResult(failure);
  }
  return { status: 'ok', revision: applySuccess(op.kind, op.path) };
}

function recordCredentials(req: Record<string, unknown>) {
  state.lastUsername = (req.username as string | null | undefined) ?? null;
  state.didReceivePassword = Boolean(req.password);
}

async function startOperation(
  kind: OperationKind,
  args: Args,
): Promise<number> {
  const req = readOperationArgs(args);
  const path = String(kind === 'checkout' ? req.dest : req.path);
  recordCredentials(req);
  const id = ++lastOperationId;
  running.set(id, { kind, path, isCancelled: false });
  const done = finishOperation(id, req);
  if (state.emitBeforeReturn) await done;
  return id;
}

function cancelOperation(id: number): boolean {
  const op = running.get(id);
  if (!op) return false;
  op.isCancelled = true;
  const wc = findWorkingCopy(op.path);
  if (wc) wc.isLocked = true;
  return true;
}

const OPERATION_COMMANDS: Record<string, OperationKind> = {
  svn_checkout: 'checkout',
  wc_update: 'update',
  wc_commit: 'commit',
  wc_cleanup: 'cleanup',
};

const SYNC_HANDLERS: Record<string, (args: Args) => unknown> = {
  workspace_get: () => state.workspace,
  workspace_set: (args) => setWorkspace(String(args?.path ?? '')),
  svn_detect: () => detection(),
  svn_set_path: (args) => setSvnPath(String(args?.path ?? '')),
  wc_info: (args) => infoFor(String(args?.path ?? '')),
  wc_status: (args) => ({
    entries: requireWorkingCopy(String(args?.path ?? '')).status,
    against_revision: null,
  }),
  op_cancel: (args) => cancelOperation(Number(args?.id)),
};

function withoutPassword(args: Args): Args {
  if (args === undefined) return args;
  const hideSecret = (key: string, value: unknown) =>
    key === 'password' && value !== null ? '***' : value;
  return JSON.parse(JSON.stringify(args, hideSecret));
}

export async function handleInvoke(
  command: string,
  args: Args,
): Promise<unknown> {
  state.calls.push({ command, args: withoutPassword(args) });
  const kind = OPERATION_COMMANDS[command];
  if (kind) return startOperation(kind, args);
  const handler = SYNC_HANDLERS[command];
  if (!handler) throw commandError('io', `Comando desconocido: ${command}`);
  return handler(args);
}

export function installMockApi() {
  (window as unknown as { __mock: unknown }).__mock = {
    state,
    setNextError: (kind: ErrorKind | null) => {
      state.nextError = kind;
    },
    addChange: (wcName: string, path: string, item: string) => {
      requireWorkingCopy(wcName).status.push({
        path,
        item,
        props: 'none',
        revision: null,
        remote_item: null,
        remote_props: null,
      });
    },
  };
}
