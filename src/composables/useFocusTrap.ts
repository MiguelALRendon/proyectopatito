import { onBeforeUnmount, onMounted, onUnmounted, type Ref } from 'vue';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
const FALLBACK_FOCUS_SELECTOR = 'main';

function canReceiveFocus(element: HTMLElement | null): element is HTMLElement {
  return (
    element !== null &&
    element !== document.body &&
    element.isConnected &&
    !element.matches(':disabled')
  );
}

export function useFocusTrap(scope: Ref<HTMLElement | null>): void {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  function getFocusableElements(): HTMLElement[] {
    if (!scope.value) return [];
    return Array.from(
      scope.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const focusable = getFocusableElements();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const isLeavingStart = event.shiftKey && active === first;
    const isLeavingEnd = !event.shiftKey && active === last;
    if (!isLeavingStart && !isLeavingEnd) return;
    event.preventDefault();
    (isLeavingStart ? last : first).focus();
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown);
    getFocusableElements()[0]?.focus();
  });

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleKeydown);
  });

  onUnmounted(() => {
    const fallback = document.querySelector<HTMLElement>(
      FALLBACK_FOCUS_SELECTOR,
    );
    (canReceiveFocus(previouslyFocused)
      ? previouslyFocused
      : fallback
    )?.focus();
  });
}
