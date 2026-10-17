import BinaryCard from '../components/documents/BinaryCard.vue';
import ImageViewer from '../components/documents/ImageViewer.vue';
import MarkdownEditor from '../components/documents/MarkdownEditor.vue';
import PdfViewer from '../components/documents/PdfViewer.vue';
import TextEditor from '../components/documents/TextEditor.vue';
import { isTooLarge } from './limits';
import {
  NO_MATCH,
  pathExtension,
  registerProvider,
  type DocumentContext,
} from './registry';

export const TEXT_SCORE = 10;
export const BINARY_SCORE = 1;
export const VIEWER_SCORE = 20;
const MARKDOWN_EXTENSION = 'md';

export function matchesText({ probe }: DocumentContext): number {
  const isEditable = probe.kind === 'text' && !isTooLarge(probe);
  return isEditable ? TEXT_SCORE : NO_MATCH;
}

export function matchesMarkdown(context: DocumentContext): number {
  const isMarkdown = pathExtension(context.path) === MARKDOWN_EXTENSION;
  return isMarkdown && matchesText(context) !== NO_MATCH
    ? VIEWER_SCORE
    : NO_MATCH;
}

export function matchesImage({ probe }: DocumentContext): number {
  return probe.kind === 'image' ? VIEWER_SCORE : NO_MATCH;
}

export function matchesPdf({ probe }: DocumentContext): number {
  return probe.kind === 'pdf' ? VIEWER_SCORE : NO_MATCH;
}

export function matchesBinary({ probe }: DocumentContext): number {
  return probe.kind === 'cloud' ? NO_MATCH : BINARY_SCORE;
}

export function registerBuiltinProviders(): void {
  registerProvider({
    id: 'text',
    label: 'Texto y código',
    matches: matchesText,
    component: TextEditor,
  });
  registerProvider({
    id: 'markdown',
    label: 'Markdown',
    matches: matchesMarkdown,
    component: MarkdownEditor,
  });
  registerProvider({
    id: 'image',
    label: 'Imagen',
    matches: matchesImage,
    component: ImageViewer,
  });
  registerProvider({
    id: 'pdf',
    label: 'PDF',
    matches: matchesPdf,
    component: PdfViewer,
  });
  registerProvider({
    id: 'binary',
    label: 'Binario',
    matches: matchesBinary,
    component: BinaryCard,
  });
}
