import type { Component } from 'vue';
import type { FileProbe } from '../services/filesApi';
import { extensionOf } from '../utils/entryOrder';
import { fileNameOf } from '../utils/folderPaths';

export const NO_MATCH = 0;

export interface DocumentContext {
  path: string;
  probe: FileProbe;
}

export interface DocumentProvider {
  id: string;
  label: string;
  matches: (context: DocumentContext) => number;
  component: Component;
}

const providers: DocumentProvider[] = [];

export function registerProvider(provider: DocumentProvider): void {
  const index = providers.findIndex((item) => item.id === provider.id);
  if (index >= 0) providers.splice(index, 1, provider);
  else providers.push(provider);
}

export function clearProviders(): void {
  providers.length = 0;
}

export function registeredProviders(): readonly DocumentProvider[] {
  return providers;
}

export function pathExtension(path: string): string {
  return extensionOf(fileNameOf(path));
}

function scoreOf(provider: DocumentProvider, context: DocumentContext) {
  try {
    const score = provider.matches(context);
    return Number.isFinite(score) ? score : NO_MATCH;
  } catch {
    return NO_MATCH;
  }
}

export function chooseProvider(
  context: DocumentContext,
): DocumentProvider | null {
  let best: DocumentProvider | null = null;
  let bestScore = NO_MATCH;
  for (const provider of providers) {
    const score = scoreOf(provider, context);
    if (score > bestScore) {
      best = provider;
      bestScore = score;
    }
  }
  return best;
}
