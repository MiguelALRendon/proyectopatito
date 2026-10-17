import { onScopeDispose, watch, type Ref } from 'vue';
import { useDocumentsStore } from '../stores/documents';
import { useTabsStore } from '../stores/tabs';
import { registerCloseGuard } from './useWindowClose';

export function useTabsSession(isReady: Ref<boolean>): void {
  const tabs = useTabsStore();
  const documents = useDocumentsStore();
  watch(
    isReady,
    (ready) => {
      if (ready) void tabs.restore();
    },
    { immediate: true },
  );
  onScopeDispose(registerCloseGuard(documents.confirmWindowClose));
}
