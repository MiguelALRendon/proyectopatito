import { inject, type InjectionKey } from 'vue';

export const DOCUMENT_TAB_KEY: InjectionKey<string> = Symbol('document-tab');

const MISSING_TAB_MESSAGE = 'El editor necesita una pestaña de documento';

export function useDocumentTab(): string {
  const tabId = inject(DOCUMENT_TAB_KEY);
  if (!tabId) throw new Error(MISSING_TAB_MESSAGE);
  return tabId;
}
