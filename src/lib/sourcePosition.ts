export type SourceAnchor = { line: number; offsetPx: number };

export function parseSourcePosition(value: string): { startLine: number; endLine: number } | null {
  const match = /^(\d+):\d+-(\d+):\d+$/.exec(value.trim());
  if (!match) return null;
  const startLine = Number(match[1]);
  const endLine = Number(match[2]);
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) return null;
  return { startLine, endLine };
}

function blocks(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[data-sourcepos]'));
}

function sourceRange(element: Element): { startLine: number; endLine: number } | null {
  const value = element.getAttribute('data-sourcepos');
  return value ? parseSourcePosition(value) : null;
}
function elementLineTop(element: Element, range: { startLine: number; endLine: number }, line: number): number {
  const rect = element.getBoundingClientRect();
  const measuredHeight = Number.isFinite(rect.height) ? rect.height : rect.bottom - rect.top;
  if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return rect.top;
  const lineCount = range.endLine - range.startLine + 1;
  const lineIndex = Math.min(Math.max(line - range.startLine, 0), lineCount - 1);
  return rect.top + measuredHeight * lineIndex / lineCount;
}

export function capturePreviewAnchor(container: HTMLElement): SourceAnchor {
  const top = container.getBoundingClientRect().top;
  const visible = blocks(container).find(element => element.getBoundingClientRect().bottom > top + 1);
  const element = visible ?? blocks(container).at(-1);
  const range = element ? sourceRange(element) : null;
  if (!element || !range) return { line: 1, offsetPx: 0 };
  const rect = element.getBoundingClientRect();
  const measuredHeight = Number.isFinite(rect.height) ? rect.height : rect.bottom - rect.top;
  const lineCount = range.endLine - range.startLine + 1;
  const visibleOffset = Number.isFinite(measuredHeight) && measuredHeight > 0 ? Math.max(top - rect.top, 0) : 0;
  const lineIndex = Number.isFinite(measuredHeight) && measuredHeight > 0
    ? Math.min(Math.floor(visibleOffset / measuredHeight * lineCount), lineCount - 1)
    : 0;
  const line = range.startLine + lineIndex;
  return { line, offsetPx: elementLineTop(element, range, line) - top };
}

export function restorePreviewAnchor(container: HTMLElement, anchor: SourceAnchor): void {
  const candidates = blocks(container).map(element => ({ element, range: sourceRange(element) })).filter((entry): entry is { element: Element; range: { startLine: number; endLine: number } } => entry.range !== null);
  if (candidates.length === 0) return;
  const target = candidates.find(entry => anchor.line >= entry.range.startLine && anchor.line <= entry.range.endLine)
    ?? candidates.find(entry => entry.range.startLine > anchor.line)
    ?? candidates[candidates.length - 1];
  const containerTop = container.getBoundingClientRect().top;
  const targetTop = elementLineTop(target.element, target.range, anchor.line);
  container.scrollTop += targetTop - containerTop - anchor.offsetPx;
}
