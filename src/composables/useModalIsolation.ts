import { onBeforeUnmount, onMounted, type Ref } from 'vue';

export const SCROLL_LOCK_CLASS = 'modal-open';
let openModalCount = 0;

function isolatableSiblings(overlay: HTMLElement): Element[] {
  return Array.from(document.body.children).filter(
    (element) =>
      element !== overlay &&
      element.tagName !== 'SCRIPT' &&
      !element.hasAttribute('inert'),
  );
}

export function useModalIsolation(overlay: Ref<HTMLElement | null>): void {
  let isolated: Element[] = [];

  onMounted(() => {
    if (!overlay.value) return;
    isolated = isolatableSiblings(overlay.value);
    isolated.forEach((element) => element.setAttribute('inert', ''));
    openModalCount += 1;
    document.body.classList.add(SCROLL_LOCK_CLASS);
  });

  onBeforeUnmount(() => {
    isolated.forEach((element) => element.removeAttribute('inert'));
    openModalCount -= 1;
    if (openModalCount === 0) document.body.classList.remove(SCROLL_LOCK_CLASS);
  });
}
