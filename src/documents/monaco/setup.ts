import * as monaco from 'monaco-editor';
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import type { Theme } from '../../composables/useTheme';

export interface CursorPosition {
  line: number;
  column: number;
}

export interface ViewerOptions {
  container: HTMLElement;
  content: string;
  path: string;
  label: string;
  theme: Theme;
  readOnly: boolean;
}

export interface Viewer {
  languageLabel: string;
  getContent: () => string;
  setContent: (content: string) => void;
  setReadOnly: (readOnly: boolean) => void;
  setTheme: (theme: Theme) => void;
  onCursorChange: (handler: (position: CursorPosition) => void) => void;
  onContentChange: (handler: (content: string) => void) => void;
  dispose: () => void;
}

type WorkerFactory = new () => Worker;

const PLAIN_TEXT_ID = 'plaintext';
const PLAIN_TEXT_LABEL = 'Texto sin formato';
const WORKERS: Record<string, WorkerFactory> = {
  json: JsonWorker,
  css: CssWorker,
  scss: CssWorker,
  less: CssWorker,
  html: HtmlWorker,
  handlebars: HtmlWorker,
  razor: HtmlWorker,
};
const THEME_BASES: Record<Theme, 'vs' | 'vs-dark'> = {
  light: 'vs',
  dark: 'vs-dark',
};
const SELECTION_ALPHA = '40';
const SELECTION_TOKEN = '--color-primary';
const THEME_TOKENS: Record<string, string> = {
  'editor.background': '--color-bg',
  'editor.foreground': '--color-text',
  'editorLineNumber.foreground': '--color-text-muted',
  'editorLineNumber.activeForeground': '--color-text',
  'editorGutter.background': '--color-bg-elevated',
  'editor.lineHighlightBackground': '--color-bg-elevated',
  'editorCursor.foreground': '--color-primary',
  'minimap.background': '--color-bg-elevated',
  'editorWidget.background': '--color-bg-elevated',
  'editorWidget.border': '--color-border',
  'input.background': '--color-bg',
  'input.border': '--color-border',
  focusBorder: '--color-primary',
};
const MODEL_SCHEME = 'dakedaduck';
const READ_ONLY_MESSAGE = 'El archivo es de solo lectura y no se puede editar';

let isConfigured = false;
let openedCount = 0;

function configure() {
  if (isConfigured) return;
  isConfigured = true;
  self.MonacoEnvironment = {
    getWorker: (_workerId, label) => new (WORKERS[label] ?? EditorWorker)(),
  };
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function expandHex(color: string): string {
  const isShort = /^#[0-9a-f]{3}$/i.test(color);
  if (!isShort) return color;
  return `#${[...color.slice(1)].map((digit) => digit + digit).join('')}`;
}

function themeColors(): Record<string, string> {
  const colorOf = (token: string) => expandHex(readToken(token));
  const colors = Object.fromEntries(
    Object.entries(THEME_TOKENS).map(([key, token]) => [key, colorOf(token)]),
  );
  colors['editor.selectionBackground'] =
    `${colorOf(SELECTION_TOKEN)}${SELECTION_ALPHA}`;
  return colors;
}

function applyTheme(theme: Theme) {
  const name = `${MODEL_SCHEME}-${theme}`;
  monaco.editor.defineTheme(name, {
    base: THEME_BASES[theme],
    inherit: true,
    rules: [],
    colors: themeColors(),
  });
  monaco.editor.setTheme(name);
}

function createModel(path: string, content: string) {
  openedCount += 1;
  const posixPath = path.replace(/\\/g, '/');
  const uri = monaco.Uri.from({
    scheme: MODEL_SCHEME,
    path: `/${openedCount}/${posixPath}`,
  });
  return monaco.editor.createModel(content, undefined, uri);
}

function labelOf(languageId: string): string {
  if (languageId === PLAIN_TEXT_ID) return PLAIN_TEXT_LABEL;
  const language = monaco.languages
    .getLanguages()
    .find((candidate) => candidate.id === languageId);
  return language?.aliases?.[0] ?? languageId;
}

function createEditor(options: ViewerOptions, model: monaco.editor.ITextModel) {
  return monaco.editor.create(options.container, {
    model,
    readOnly: options.readOnly,
    readOnlyMessage: { value: READ_ONLY_MESSAGE },
    automaticLayout: true,
    minimap: { enabled: true },
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    fontFamily: readToken('--font-family-mono'),
    fontSize: parseFloat(readToken('--font-size-base')),
    ariaLabel: options.label,
  });
}

type ContentControls = Pick<
  Viewer,
  'getContent' | 'setContent' | 'onContentChange'
>;

function contentControls(model: monaco.editor.ITextModel): ContentControls {
  let isReplacing = false;
  return {
    getContent: () => model.getValue(),
    setContent: (content) => {
      isReplacing = true;
      model.setValue(content);
      isReplacing = false;
    },
    onContentChange: (handler) => {
      model.onDidChangeContent(() => {
        if (!isReplacing) handler(model.getValue());
      });
    },
  };
}

export function openViewer(options: ViewerOptions): Viewer {
  configure();
  applyTheme(options.theme);
  const model = createModel(options.path, options.content);
  const editor = createEditor(options, model);
  return {
    ...contentControls(model),
    languageLabel: labelOf(model.getLanguageId()),
    setReadOnly: (readOnly) => editor.updateOptions({ readOnly }),
    setTheme: applyTheme,
    onCursorChange: (handler) => {
      editor.onDidChangeCursorPosition(({ position }) =>
        handler({ line: position.lineNumber, column: position.column }),
      );
    },
    dispose: () => {
      editor.dispose();
      model.dispose();
    },
  };
}
