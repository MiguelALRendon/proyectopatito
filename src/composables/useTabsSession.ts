import { onScopeDispose, watch, type Ref } from 'vue';
import { confirmWindowClose } from '../documents/windowClose';
import { useTabsStore } from '../stores/tabs';
import { registerCloseGuard } from './useWindowClose';

export function useTabsSession(isReady: Ref<boolean>): void {
  const tabs = useTabsStore();
  watch(
    isReady,
    (ready) => {
      if (ready) void tabs.restore();
    },
    { immediate: true },
  );
  onScopeDispose(registerCloseGuard(confirmWindowClose));
}
