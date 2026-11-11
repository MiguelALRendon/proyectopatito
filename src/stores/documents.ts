import { reactive, watch } from 'vue';
import { defineStore } from 'pinia';
import { askLineEnding } from '../documents/dialogs';
import { createSaveFlight } from '../documents/saveFlight';
import {
  fsReadText,
  fsWriteText,
  type LineEnding,
  type TextDocument,
  type TextEncoding,
  type WriteTextRequest,
} from '../services/filesApi';
import {
  normalizeError,
  type CommandError,
  type ErrorKind,
} from '../services/tauri';
import { fileNameOf } from '../utils/folderPaths';
import { useExplorerStore } from './explorer';
import { useTabsStore } from './tabs';

export type DocumentPhase = 'loading' | 'ready' | 'saving' | 'failed';

export type SaveOutcome =
  | 'saved'
  | 'unchanged'
  | 'needs-eol'
  | 'conflict'
  | 'read-only'
  | 'failed'
  | 'unavailable';

export interface DocumentSession {
  tabId: string;
  path: string;
  phase: DocumentPhase;
  original: string;
  current: string;
  version: string;
  encoding: TextEncoding;
  hasBom: boolean;
  eol: LineEnding;
  eolMixed: boolean;
  isDirty: boolean;
  isReadOnly: boolean;
  hasConflict: boolean;
  error: CommandError | null;
  revision: number;
}

const FAILURE_OUTCOMES: Partial<Record<ErrorKind, SaveOutcome>> = {
  file_changed: 'conflict',
  read_only: 'read-only',
};
const NOT_EDITABLE_KINDS: ErrorKind[] = ['not_text', 'too_large', 'cloud_only'];
const SETTLED_OUTCOMES: SaveOutcome[] = ['saved', 'unchanged'];

export function isSettled(outcome: SaveOutcome): boolean {
  return SETTLED_OUTCOMES.includes(outcome);
}

function blankSession(tabId: string, path: string): DocumentSession {
  return {
    tabId,
    path,
    phase: 'loading',
    original: '',
    current: '',
    version: '',
    encoding: 'utf8',
    hasBom: false,
    eol: 'lf',
    eolMixed: false,
    isDirty: false,
    isReadOnly: false,
    hasConflict: false,
    error: null,
    revision: 0,
  };
}

function loadedFields(document: TextDocument): Partial<DocumentSession> {
  return {
    phase: 'ready',
    original: document.content,
    current: document.content,
    version: document.version,
    encoding: document.encoding,
    hasBom: document.has_bom,
    eol: document.eol,
    eolMixed: document.eol_mixed,
    isReadOnly: false,
    hasConflict: false,
    error: null,
  };
}

function writeRequest(
  session: DocumentSession,
  content: string,
): WriteTextRequest {
  return {
    path: session.path,
    content,
    encoding: session.encoding,
    has_bom: session.hasBom,
    eol: session.eol,
    expected_version: session.version,
  };
}

function isOpen(session: DocumentSession): boolean {
  return session.phase === 'ready' || session.phase === 'saving';
}

export function refusalOf(session: DocumentSession): SaveOutcome | null {
  if (session.phase !== 'ready') return 'unavailable';
  if (!session.isDirty) return 'unchanged';
  return session.eolMixed ? 'needs-eol' : null;
}

export const useDocumentsStore = defineStore('documents', () => {
  const tabs = useTabsStore();
  const explorer = useExplorerStore();
  const sessions = reactive<Record<string, DocumentSession>>({});
  const tickets = new Map<string, number>();
  const flight = createSaveFlight<SaveOutcome>();

  const sessionOf = (tabId: string): DocumentSession | null =>
    sessions[tabId] ?? null;
  const dirtySessions = () =>
    Object.values(sessions).filter((session) => session.isDirty);

  function nextTicket(tabId: string): number {
    const ticket = (tickets.get(tabId) ?? 0) + 1;
    tickets.set(tabId, ticket);
    return ticket;
  }

  const isCurrent = (tabId: string, ticket: number) =>
    tabId in sessions && tickets.get(tabId) === ticket;

  function setDirty(session: DocumentSession, isDirty: boolean) {
    if (session.isDirty === isDirty) return;
    session.isDirty = isDirty;
    tabs.setDirty(session.tabId, isDirty);
  }

  function applyLoaded(session: DocumentSession, document: TextDocument) {
    Object.assign(session, loadedFields(document), {
      revision: session.revision + 1,
    });
    setDirty(session, false);
  }

  function failLoad(session: DocumentSession, error: CommandError) {
    Object.assign(session, { phase: 'failed', error, hasConflict: false });
    setDirty(session, false);
  }

  async function load(tabId: string, path: string): Promise<void> {
    const ticket = nextTicket(tabId);
    tabs.setDirty(tabId, false);
    sessions[tabId] = blankSession(tabId, path);
    try {
      const document = await fsReadText(path);
      if (isCurrent(tabId, ticket)) applyLoaded(sessions[tabId], document);
    } catch (error) {
      if (isCurrent(tabId, ticket)) {
        failLoad(sessions[tabId], normalizeError(error));
      }
    }
  }

  async function open(tabId: string, path: string): Promise<void> {
    const existing = sessions[tabId];
    const isUsable = existing?.path === path && existing.phase !== 'failed';
    if (!isUsable) await load(tabId, path);
  }

  function failReload(session: DocumentSession, error: CommandError) {
    if (NOT_EDITABLE_KINDS.includes(error.kind)) failLoad(session, error);
    else session.error = error;
  }

  async function reload(tabId: string): Promise<boolean> {
    const session = sessions[tabId];
    if (!session || session.phase !== 'ready') return false;
    const ticket = nextTicket(tabId);
    const isStale = () =>
      !isCurrent(tabId, ticket) || session.phase !== 'ready';
    try {
      const document = await fsReadText(session.path);
      if (isStale()) return false;
      applyLoaded(session, document);
      return true;
    } catch (error) {
      if (!isStale()) failReload(session, normalizeError(error));
      return false;
    }
  }

  function edit(tabId: string, content: string) {
    const session = sessions[tabId];
    if (!session || !isOpen(session)) return;
    session.current = content;
    setDirty(session, content !== session.original);
  }

  function rebase(tabId: string, content: string) {
    const session = sessions[tabId];
    if (!session || !isOpen(session)) return;
    if (!session.isDirty) session.original = content;
    edit(tabId, content);
  }

  function setLineEnding(tabId: string, eol: LineEnding) {
    const session = sessions[tabId];
    if (!session) return;
    Object.assign(session, { eol, eolMixed: false });
  }

  function dismissConflict(tabId: string) {
    const session = sessions[tabId];
    if (session) session.hasConflict = false;
  }

  function markSaved(
    session: DocumentSession,
    content: string,
    version: string,
  ): SaveOutcome {
    Object.assign(session, {
      phase: 'ready',
      original: content,
      version,
      isReadOnly: false,
      hasConflict: false,
      error: null,
    });
    setDirty(session, session.current !== content);
    void explorer.refreshStatus();
    return 'saved';
  }

  function failSave(session: DocumentSession, error: CommandError) {
    const outcome = FAILURE_OUTCOMES[error.kind] ?? 'failed';
    session.phase = 'ready';
    if (outcome === 'conflict') session.hasConflict = true;
    else if (outcome === 'read-only') session.isReadOnly = true;
    else session.error = error;
    return outcome;
  }

  async function save(tabId: string): Promise<SaveOutcome> {
    const session = sessions[tabId];
    if (!session) return 'unavailable';
    const running = flight.current(tabId);
    if (running) return saveEditsMadeMeanwhile(tabId, await running);
    const refusal = refusalOf(session);
    if (refusal) return refusal;
    const tracked = flight.track(tabId, writeToDisk(tabId, session));
    tabs.trackSave(tabId, tracked);
    return tracked;
  }

  function saveEditsMadeMeanwhile(tabId: string, outcome: SaveOutcome) {
    const hasNewEdits = outcome === 'saved' && sessions[tabId]?.isDirty;
    return hasNewEdits ? save(tabId) : outcome;
  }

  async function writeToDisk(
    tabId: string,
    session: DocumentSession,
  ): Promise<SaveOutcome> {
    const content = session.current;
    Object.assign(session, { phase: 'saving', error: null });
    nextTicket(tabId);
    try {
      const written = await fsWriteText(writeRequest(session, content));
      return markSaved(session, content, written.version);
    } catch (error) {
      return failSave(session, normalizeError(error));
    }
  }

  async function overwrite(tabId: string): Promise<SaveOutcome> {
    const session = sessions[tabId];
    if (!session || session.phase !== 'ready') return 'unavailable';
    try {
      session.version = (await fsReadText(session.path)).version;
    } catch (error) {
      return failSave(session, normalizeError(error));
    }
    session.hasConflict = false;
    return save(tabId);
  }

  async function saveResolvingLineEnding(tabId: string): Promise<SaveOutcome> {
    const outcome = await save(tabId);
    const session = sessions[tabId];
    if (outcome !== 'needs-eol' || !session) return outcome;
    const eol = await askLineEnding(fileNameOf(session.path), session.eol);
    if (!eol) return outcome;
    setLineEnding(tabId, eol);
    return save(tabId);
  }

  function dropMissing(openIds: string[]) {
    Object.keys(sessions)
      .filter((tabId) => !openIds.includes(tabId))
      .forEach((tabId) => {
        delete sessions[tabId];
        tickets.delete(tabId);
      });
  }

  watch(() => tabs.tabs.map((tab) => tab.id), dropMissing);

  return {
    sessionOf,
    open,
    load,
    reload,
    edit,
    rebase,
    setLineEnding,
    dismissConflict,
    save,
    saveResolvingLineEnding,
    overwrite,
    dirtySessions,
  };
});
