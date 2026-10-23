import { computed, reactive, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import {
  askConflict,
  askLegacyFidelity,
  askSwitchOffice,
} from '../documents/dialogs';
import { MAX_OFFICE_BYTES } from '../documents/limits';
import { createSaveFlight } from '../documents/saveFlight';
import { OfficeError, officeHost } from '../documents/office/officeHost';
import type {
  OfficeFormat,
  OfficeKind,
} from '../documents/office/officeProtocol';
import { fsProbe, fsWriteBytes } from '../services/filesApi';
import {
  normalizeError,
  type CommandError,
  type ErrorKind,
} from '../services/tauri';
import { fileNameOf } from '../utils/folderPaths';
import { isSettled, type SaveOutcome } from './documents';
import { useExplorerStore } from './explorer';
import { useTabsStore } from './tabs';

const LEGACY_FORMATS: OfficeFormat[] = ['doc', 'xls', 'ppt'];
const FAILURE_OUTCOMES: Partial<Record<ErrorKind, SaveOutcome>> = {
  file_changed: 'conflict',
  read_only: 'read-only',
};
const HOST_FAILURE_MESSAGE = 'ZetaOffice no pudo entregar el documento';
const TOO_LARGE_MESSAGE = 'El documento superó el tamaño máximo de Office';

export interface OfficeSession {
  tabId: string;
  path: string;
  docId: string;
  ext: OfficeFormat;
  kind: OfficeKind;
  version: string;
  isDirty: boolean;
  isSaving: boolean;
  isReadOnly: boolean;
  hasConflict: boolean;
  hasAcceptedFidelity: boolean;
  hasEditsWhileSaving: boolean;
  error: CommandError | null;
  reloadTicket: number;
}

export interface OfficeAttachment {
  tabId: string;
  path: string;
  docId: string;
  ext: OfficeFormat;
  kind: OfficeKind;
  version: string;
}

function startedSession(attachment: OfficeAttachment): OfficeSession {
  return {
    ...attachment,
    isDirty: false,
    isSaving: false,
    isReadOnly: false,
    hasConflict: false,
    hasAcceptedFidelity: false,
    hasEditsWhileSaving: false,
    error: null,
    reloadTicket: 0,
  };
}

function commandError(kind: ErrorKind, message: string): CommandError {
  return { kind, message, codes: [], detail: null };
}

function failureOf(error: unknown): CommandError {
  if (error instanceof OfficeError) {
    return commandError('io', HOST_FAILURE_MESSAGE);
  }
  return normalizeError(error);
}

export const useOfficeStore = defineStore('office', () => {
  const tabs = useTabsStore();
  const flight = createSaveFlight<SaveOutcome>();
  const explorer = useExplorerStore();
  const sessions = reactive<Record<string, OfficeSession>>({});
  const liveTabId = ref<string | null>(null);

  const sessionOf = (tabId: string): OfficeSession | null =>
    sessions[tabId] ?? null;
  const dirtySessions = () =>
    Object.values(sessions).filter((session) => session.isDirty);
  const hasLiveDocument = computed(() => liveTabId.value !== null);

  function setDirty(session: OfficeSession, isDirty: boolean) {
    session.isDirty = isDirty;
    tabs.setDirty(session.tabId, isDirty);
  }

  function attach(attachment: OfficeAttachment) {
    sessions[attachment.tabId] = startedSession(attachment);
    liveTabId.value = attachment.tabId;
    tabs.setDirty(attachment.tabId, false);
  }

  function detach(tabId: string) {
    if (!(tabId in sessions)) return;
    delete sessions[tabId];
    tabs.setDirty(tabId, false);
    if (liveTabId.value === tabId) liveTabId.value = null;
  }

  function markModified(docId: string) {
    const session = Object.values(sessions).find(
      (candidate) => candidate.docId === docId,
    );
    if (!session) return;
    if (session.isSaving) session.hasEditsWhileSaving = true;
    setDirty(session, true);
  }

  function markSaved(session: OfficeSession, version: string): SaveOutcome {
    Object.assign(session, {
      version,
      isSaving: false,
      isReadOnly: false,
      hasConflict: false,
      error: null,
    });
    setDirty(session, session.hasEditsWhileSaving);
    session.hasEditsWhileSaving = false;
    void explorer.refreshStatus();
    return 'saved';
  }

  function failSave(session: OfficeSession, error: unknown): SaveOutcome {
    const failure = failureOf(error);
    const outcome = FAILURE_OUTCOMES[failure.kind] ?? 'failed';
    session.isSaving = false;
    if (outcome === 'conflict') session.hasConflict = true;
    else if (outcome === 'read-only') session.isReadOnly = true;
    else session.error = failure;
    return outcome;
  }

  async function acceptsFidelityLoss(session: OfficeSession) {
    const isLegacy = LEGACY_FORMATS.includes(session.ext);
    if (!isLegacy || session.hasAcceptedFidelity) return true;
    const isAccepted = await askLegacyFidelity(fileNameOf(session.path));
    session.hasAcceptedFidelity = isAccepted;
    return isAccepted;
  }

  async function writeToDisk(session: OfficeSession): Promise<SaveOutcome> {
    const bytes = await officeHost.save(session.docId);
    if (bytes.byteLength > MAX_OFFICE_BYTES) {
      throw commandError('office_too_large', TOO_LARGE_MESSAGE);
    }
    const written = await fsWriteBytes(
      session.path,
      session.version,
      new Uint8Array(bytes),
    );
    return markSaved(session, written.version);
  }

  async function save(tabId: string): Promise<SaveOutcome> {
    const session = sessions[tabId];
    if (!session) return 'unavailable';
    const running = flight.current(tabId);
    if (running) return saveEditsMadeMeanwhile(tabId, await running);
    if (!session.isDirty) return 'unchanged';
    return trackSave(tabId, runSave(session));
  }

  function saveEditsMadeMeanwhile(tabId: string, outcome: SaveOutcome) {
    const hasNewEdits = outcome === 'saved' && sessions[tabId]?.isDirty;
    return hasNewEdits ? save(tabId) : outcome;
  }

  function trackSave(tabId: string, attempt: Promise<SaveOutcome>) {
    const tracked = flight.track(tabId, attempt);
    tabs.trackSave(tabId, tracked);
    return tracked;
  }

  async function runSave(session: OfficeSession): Promise<SaveOutcome> {
    if (!(await acceptsFidelityLoss(session))) return 'failed';
    Object.assign(session, {
      isSaving: true,
      error: null,
      hasEditsWhileSaving: false,
    });
    try {
      return await writeToDisk(session);
    } catch (error) {
      return failSave(session, error);
    }
  }

  async function persistUnrequestedSave(
    docId: string,
    bytes: ArrayBuffer,
  ): Promise<SaveOutcome> {
    const session = Object.values(sessions).find(
      (candidate) => candidate.docId === docId,
    );
    if (!session || flight.current(session.tabId)) return 'unavailable';
    Object.assign(session, { isSaving: true, hasEditsWhileSaving: false });
    const attempt = fsWriteBytes(
      session.path,
      session.version,
      new Uint8Array(bytes),
    ).then(
      (written) => markSaved(session, written.version),
      (error: unknown) => {
        setDirty(session, true);
        return failSave(session, error);
      },
    );
    return trackSave(session.tabId, attempt);
  }

  function reload(tabId: string) {
    const session = sessions[tabId];
    if (!session) return;
    Object.assign(session, {
      isReadOnly: false,
      hasConflict: false,
      error: null,
      reloadTicket: session.reloadTicket + 1,
    });
    setDirty(session, false);
  }

  async function overwrite(tabId: string): Promise<SaveOutcome> {
    const session = sessions[tabId];
    if (!session || session.isSaving) return 'unavailable';
    try {
      const probe = await fsProbe(session.path);
      session.version = probe.version ?? '';
    } catch (error) {
      return failSave(session, error);
    }
    session.hasConflict = false;
    return save(tabId);
  }

  async function saveResolvingConflict(tabId: string): Promise<SaveOutcome> {
    const outcome = await save(tabId);
    const session = sessions[tabId];
    if (outcome !== 'conflict' || !session) return outcome;
    const choice = await askConflict(fileNameOf(session.path));
    if (choice === 'overwrite') return overwrite(tabId);
    if (choice !== 'reload') return outcome;
    reload(tabId);
    return 'unchanged';
  }

  async function releaseFor(tabId: string): Promise<boolean> {
    const live = liveTabId.value;
    const session = live ? sessions[live] : null;
    if (!live || !session || live === tabId) return true;
    if (session.isDirty) {
      const choice = await askSwitchOffice(fileNameOf(session.path));
      if (!choice) return false;
      if (choice === 'save' && !isSettled(await saveResolvingConflict(live))) {
        return false;
      }
    }
    detach(live);
    return true;
  }

  function dropMissing(openIds: string[]) {
    Object.keys(sessions)
      .filter((tabId) => !openIds.includes(tabId))
      .forEach(detach);
  }

  watch(() => tabs.tabs.map((tab) => tab.id), dropMissing);

  return {
    sessions,
    liveTabId,
    hasLiveDocument,
    sessionOf,
    dirtySessions,
    attach,
    detach,
    markModified,
    save,
    saveResolvingConflict,
    persistUnrequestedSave,
    overwrite,
    reload,
    releaseFor,
  };
});
