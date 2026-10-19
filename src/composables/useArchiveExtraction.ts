import { onBeforeUnmount, ref, shallowRef } from 'vue';
import {
  archiveCancel,
  archiveExtract,
  newArchiveTaskId,
  onArchiveProgress,
  type ExtractProgress,
  type ExtractReport,
} from '../services/archiveApi';
import { normalizeError, type CommandError } from '../services/tauri';

export type ExtractPhase =
  'idle' | 'running' | 'done' | 'failed' | 'cancelled' | 'needs_confirmation';

function phaseOfFailure(error: CommandError): ExtractPhase {
  if (error.kind === 'cancelled') return 'cancelled';
  if (error.kind === 'archive_needs_confirmation') return 'needs_confirmation';
  return 'failed';
}

export function useArchiveExtraction(path: () => string) {
  const phase = ref<ExtractPhase>('idle');
  const progress = shallowRef<ExtractProgress | null>(null);
  const report = shallowRef<ExtractReport | null>(null);
  const failure = shallowRef<CommandError | null>(null);
  let taskId = 0;
  let stopListening: (() => void) | null = null;

  async function listen(id: number) {
    try {
      stopListening = await onArchiveProgress((next) => {
        if (next.id === id) progress.value = next;
      });
    } catch {
      stopListening = null;
    }
  }

  async function start(allowSuspicious = false) {
    if (phase.value === 'running') return;
    const id = newArchiveTaskId();
    taskId = id;
    phase.value = 'running';
    progress.value = null;
    failure.value = null;
    await listen(id);
    try {
      report.value = await archiveExtract(path(), id, allowSuspicious);
      phase.value = 'done';
    } catch (raw) {
      failure.value = normalizeError(raw);
      phase.value = phaseOfFailure(failure.value);
    } finally {
      stopListening?.();
      stopListening = null;
    }
  }

  async function cancel() {
    if (phase.value !== 'running') return;
    await archiveCancel(taskId).catch(() => false);
  }

  onBeforeUnmount(() => {
    void cancel();
    stopListening?.();
  });

  return { phase, progress, report, failure, start, cancel };
}
