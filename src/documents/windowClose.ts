import { isSettled, useDocumentsStore } from '../stores/documents';
import { useOfficeStore } from '../stores/office';
import { useTabsStore } from '../stores/tabs';
import { askWindowClose } from './dialogs';

function dirtyTabIds(): string[] {
  const dirty = [
    ...useDocumentsStore().dirtySessions(),
    ...useOfficeStore().dirtySessions(),
  ];
  return dirty.map((session) => session.tabId);
}

function saveTab(tabId: string) {
  const office = useOfficeStore();
  if (office.sessionOf(tabId)) return office.saveResolvingConflict(tabId);
  return useDocumentsStore().saveResolvingLineEnding(tabId);
}

export async function saveAll(): Promise<boolean> {
  for (const tabId of dirtyTabIds()) {
    if (isSettled(await saveTab(tabId))) continue;
    useTabsStore().activate(tabId);
    return false;
  }
  return true;
}

export async function confirmWindowClose(): Promise<boolean> {
  await useTabsStore().flushWithinLimit();
  await useTabsStore().settleSaves();
  const isSaving = useTabsStore().hasPendingSave();
  const dirtyCount = dirtyTabIds().length;
  if (dirtyCount === 0) return true;
  const choice = await askWindowClose(dirtyCount, isSaving);
  if (choice === 'save') return (await saveAll()) && dirtyTabIds().length === 0;
  return choice === 'discard';
}
