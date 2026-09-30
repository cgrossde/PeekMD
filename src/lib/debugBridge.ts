import type { EditStatus, FileRevision } from '../store';
import type { PreviewCursor } from './sourcePosition';

export type DebugSnapshot = {
  mode: 'empty' | 'preview' | 'editor';
  activeDocument: { path: string; title: string; revision: FileRevision; dirty: boolean } | null;
  editSession: { path: string; status: EditStatus; baseRevision: FileRevision; resetGeneration: number } | null;
  editorCursor: { offset: number; line: number; column: number } | null;
  previewCursor: PreviewCursor | null;
  pendingPreviewCursor: { path: string; offset: number; attempts: number } | null;
};

export type DebugConsoleEntry = {
  timestamp: string;
  level: 'warn' | 'error';
  message: string;
};

export type EditorCursorInput = { offset?: number; line?: number; column?: number };

export type PeekMdDebugBridge = {
  getState(): DebugSnapshot;
  toggleEditMode(): Promise<boolean>;
  setEditorCursor(input: EditorCursorInput): boolean;
  setPreviewCursor(selector: string, renderedOffset: number): boolean;
  openFile(path: string): Promise<void>;
  closeDocument(path: string): Promise<boolean>;
  refreshActive(): Promise<void>;
  getConsoleEntries(): DebugConsoleEntry[];
  clearConsoleEntries(): void;
};

declare global {
  interface Window {
    __PEEKMD_DEBUG__?: PeekMdDebugBridge;
  }
}

const MAX_CONSOLE_ENTRIES = 100;
let capturedEntries: DebugConsoleEntry[] = [];
let captureInstalled = false;

function printable(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function record(level: DebugConsoleEntry['level'], args: unknown[]): void {
  capturedEntries = [...capturedEntries, { timestamp: new Date().toISOString(), level, message: args.map(printable).join(' ') }].slice(-MAX_CONSOLE_ENTRIES);
}

export function installDebugCapture(): void {
  if (!import.meta.env.DEV || captureInstalled) return;
  captureInstalled = true;
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.warn = (...args: unknown[]) => { record('warn', args); originalWarn(...args); };
  console.error = (...args: unknown[]) => { record('error', args); originalError(...args); };
  window.addEventListener('error', event => record('error', [event.error ?? event.message]));
  window.addEventListener('unhandledrejection', event => record('error', [event.reason]));
}

export function getDebugConsoleEntries(): DebugConsoleEntry[] {
  return capturedEntries.slice();
}

export function clearDebugConsoleEntries(): void {
  capturedEntries = [];
}
