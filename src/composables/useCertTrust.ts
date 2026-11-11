import { ref } from 'vue';
import {
  marketplaceCertImport,
  marketplaceCertInspect,
  marketplaceCertTrust,
  type CertPrompt,
} from '../services/marketplaceApi';
import { normalizeError, pickFile, type CommandError } from '../services/tauri';
import { AUTHORITY_FILTERS } from '../utils/certFilters';

export type CertStep =
  | { kind: 'idle' }
  | { kind: 'retry' }
  | { kind: 'failed'; error: CommandError };

const IDLE: CertStep = { kind: 'idle' };
const RETRY: CertStep = { kind: 'retry' };

export function useCertTrust() {
  const prompt = ref<CertPrompt | null>(null);
  const isBusy = ref(false);
  let inspectedUrl = '';
  let flow = 0;

  async function inspect(
    url: string,
    repoId: number | null,
  ): Promise<CommandError | null> {
    const token = ++flow;
    try {
      const found = await marketplaceCertInspect(url, repoId);
      if (token !== flow) return null;
      inspectedUrl = url;
      prompt.value = found;
      return null;
    } catch (raw) {
      return token === flow ? normalizeError(raw) : null;
    }
  }

  function finish(token: number, step: CertStep): CertStep {
    if (token !== flow) return IDLE;
    prompt.value = null;
    return step;
  }

  async function settle(action: () => Promise<unknown>): Promise<CertStep> {
    const token = flow;
    isBusy.value = true;
    try {
      await action();
      return finish(token, RETRY);
    } catch (raw) {
      return finish(token, { kind: 'failed', error: normalizeError(raw) });
    } finally {
      isBusy.value = false;
    }
  }

  async function trust(): Promise<CertStep> {
    const shown = prompt.value;
    if (!shown) return IDLE;
    const request = {
      url: inspectedUrl,
      sha256: shown.info.sha256,
      allowed: [...shown.reasons],
    };
    return settle(() => marketplaceCertTrust(request));
  }

  async function importAuthority(): Promise<CertStep> {
    const token = flow;
    try {
      const path = await pickFile(AUTHORITY_FILTERS);
      if (path === null) return IDLE;
      return settle(() => marketplaceCertImport(path));
    } catch (raw) {
      return finish(token, { kind: 'failed', error: normalizeError(raw) });
    }
  }

  function dismiss() {
    flow += 1;
    prompt.value = null;
  }

  return { prompt, isBusy, inspect, trust, importAuthority, dismiss };
}
