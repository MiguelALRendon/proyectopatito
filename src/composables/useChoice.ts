import { readonly, ref, type Ref } from 'vue';

export type ChoiceTone = 'neutral' | 'primary' | 'danger';

export interface ChoiceOption<T extends string = string> {
  value: T;
  label: string;
  tone?: ChoiceTone;
}

export interface ChoiceRequest<T extends string = string> {
  title: string;
  message: string;
  options: ChoiceOption<T>[];
}

const request = ref<ChoiceRequest | null>(null);
let pendingResolve: ((value: string | null) => void) | null = null;

export function useChoice(): { request: Readonly<Ref<ChoiceRequest | null>> } {
  return { request: readonly(request) as Readonly<Ref<ChoiceRequest | null>> };
}

export function resolveChoice(value: string | null): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  request.value = null;
  resolve?.(value);
}

export function choose<T extends string>(
  question: ChoiceRequest<T>,
): Promise<T | null> {
  if (pendingResolve) resolveChoice(null);
  request.value = question;
  return new Promise<T | null>((resolve) => {
    pendingResolve = resolve as (value: string | null) => void;
  });
}
