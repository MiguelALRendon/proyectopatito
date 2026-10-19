import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  normalizeError,
  svnDetect,
  svnSetPath,
  workspaceGet,
  workspaceSet,
  type CommandError,
  type SvnDetection,
} from '../services/tauri';

export const useWorkspaceStore = defineStore('workspace', () => {
  const root = ref<string | null>(null);
  const svn = ref<SvnDetection | null>(null);
  const error = ref<CommandError | null>(null);
  const isLoaded = ref(false);

  const svnVersion = computed(() => svn.value?.binary?.version ?? null);
  const hasSvn = computed(() => svn.value?.binary != null);
  const isOnboarded = computed(() => root.value !== null && hasSvn.value);

  function keepWorkingClient(
    previous: SvnDetection | null,
    next: SvnDetection,
  ): SvnDetection {
    if (next.binary || !previous?.binary) return next;
    return {
      binary: previous.binary,
      error: next.error,
      warning: previous.warning,
    };
  }

  async function guarded(action: () => Promise<void>): Promise<boolean> {
    error.value = null;
    try {
      await action();
      return true;
    } catch (raw) {
      error.value = normalizeError(raw);
      return false;
    }
  }

  async function load(): Promise<void> {
    await guarded(async () => {
      [root.value, svn.value] = await Promise.all([
        workspaceGet(),
        svnDetect(),
      ]);
    });
    isLoaded.value = true;
  }

  const setRoot = (path: string) =>
    guarded(async () => {
      root.value = await workspaceSet(path);
    });

  async function detection(
    action: () => Promise<SvnDetection>,
  ): Promise<boolean> {
    const isOk = await guarded(async () => {
      svn.value = await action();
    });
    return isOk && svn.value?.binary != null && svn.value.error == null;
  }

  const setSvnPath = (path: string) =>
    detection(async () => keepWorkingClient(svn.value, await svnSetPath(path)));

  const detectSvn = () => detection(svnDetect);

  return {
    root,
    svn,
    error,
    isLoaded,
    svnVersion,
    hasSvn,
    isOnboarded,
    load,
    setRoot,
    setSvnPath,
    detectSvn,
  };
});
