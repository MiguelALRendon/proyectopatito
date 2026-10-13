import { readonly, ref, type Ref } from 'vue';

const DEFAULT_CONFIRM_LABEL = 'Aceptar';
const DEFAULT_CONFIRM_TITLE = 'Confirmar acción';

const message = ref<string | null>(null);
const confirmLabel = ref<string>(DEFAULT_CONFIRM_LABEL);
const title = ref<string>(DEFAULT_CONFIRM_TITLE);
let pendingResolve: ((result: boolean) => void) | null = null;

export interface ConfirmHandle {
  message: Readonly<Ref<string | null>>;
  confirmLabel: Readonly<Ref<string>>;
  title: Readonly<Ref<string>>;
}

export function useConfirm(): ConfirmHandle {
  return {
    message: readonly(message),
    confirmLabel: readonly(confirmLabel),
    title: readonly(title),
  };
}

export function confirm(
  mensaje: string,
  confirmLabelParam: string = DEFAULT_CONFIRM_LABEL,
  titleParam: string = DEFAULT_CONFIRM_TITLE,
): Promise<boolean> {
  if (pendingResolve) {
    resolveConfirm(false);
  }
  message.value = mensaje;
  confirmLabel.value = confirmLabelParam;
  title.value = titleParam;
  return new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
  });
}

export function resolveConfirm(result: boolean): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  message.value = null;
  confirmLabel.value = DEFAULT_CONFIRM_LABEL;
  title.value = DEFAULT_CONFIRM_TITLE;
  resolve?.(result);
}
