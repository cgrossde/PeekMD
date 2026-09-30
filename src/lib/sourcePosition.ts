import type { Text } from '@codemirror/state';
export type SourceAnchor = { line: number; offsetPx: number };

export function parseSourcePosition(value: string): { startLine: number; endLine: number } | null {
  const match = /^(\d+):\d+-(\d+):\d+$/.exec(value.trim());
  if (!match) return null;
  const startLine = Number(match[1]);
  const endLine = Number(match[2]);
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) return null;
  return { startLine, endLine };
}
export type SourcePositionRange = { startLine: number; startColumn: number; endLine: number; endColumn: number };
export type PreviewCursor = { sourceRange: SourcePositionRange; renderedText: string; renderedOffset: number; sourceOffset?: number };

export function parseSourceRange(value: string): SourcePositionRange | null {
  const match = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(value.trim());
  if (!match) return null;
  const [startLine, startColumn, endLine, endColumn] = match.slice(1).map(Number);
  if (![startLine, startColumn, endLine, endColumn].every(Number.isSafeInteger) || startLine < 1 || startColumn < 1 || endLine < startLine || (endLine === startLine && endColumn < startColumn)) return null;
  return { startLine, startColumn, endLine, endColumn };
}

function utf8Width(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
}

function utf16OffsetAtByteColumn(line: string, column: number, inclusiveEnd: boolean): number {
  const target = Math.max(column - 1, 0);
  let bytes = 0;
  let offset = 0;
  for (const character of line) {
    const width = utf8Width(character);
    if (inclusiveEnd ? bytes >= target || bytes + width > target : bytes + width > target) return inclusiveEnd ? offset + character.length : offset;
    bytes += width;
    offset += character.length;
  }
  return line.length;
}

function sourcePositionToOffset(text: Text, lineNumber: number, column: number, inclusiveEnd: boolean): number {
  if (lineNumber > text.lines) return text.length;
  const line = text.line(Math.max(lineNumber, 1));
  return Math.min(line.from + utf16OffsetAtByteColumn(line.text, column, inclusiveEnd), line.to);
}

export function sourceRangeToOffsets(text: Text, range: SourcePositionRange): { from: number; to: number } {
  const from = sourcePositionToOffset(text, range.startLine, range.startColumn, false);
  const to = sourcePositionToOffset(text, range.endLine, range.endColumn, true);
  return to >= from ? { from, to } : { from: to, to: from };
}

function decodedSource(value: string): { text: string; sourceOffsets: number[] } {
  if (typeof document === 'undefined' || !value.includes('&')) return { text: value, sourceOffsets: Array.from({ length: value.length + 1 }, (_, index) => index) };
  const decoder = document.createElement('textarea');
  const sourceOffsets = [0];
  let text = '';
  let index = 0;
  while (index < value.length) {
    const entity = /^&(?:[a-z][a-z0-9]+|#\d+|#x[0-9a-f]+);/i.exec(value.slice(index))?.[0];
    if (entity) {
      decoder.innerHTML = entity;
      const decoded = decoder.value;
      if (decoded !== entity) {
        text += decoded;
        index += entity.length;
        for (let unit = 0; unit < decoded.length; unit += 1) sourceOffsets.push(index);
        continue;
      }
    }
    text += value[index];
    index += 1;
    sourceOffsets.push(index);
  }
  return { text, sourceOffsets };
}

export function renderedOffsetToSourceOffset(source: string, rendered: string, renderedOffset: number): number | null {
  const directStart = source.indexOf(rendered);
  if (directStart >= 0) return directStart + Math.min(Math.max(renderedOffset, 0), rendered.length);
  const decoded = decodedSource(source);
  const decodedStart = decoded.text.indexOf(rendered);
  if (decodedStart < 0) return null;
  const offset = decodedStart + Math.min(Math.max(renderedOffset, 0), rendered.length);
  return decoded.sourceOffsets[offset] ?? null;
}

export function sourceOffsetToRenderedOffset(source: string, rendered: string, sourceOffset: number): number | null {
  const directStart = source.indexOf(rendered);
  if (directStart >= 0) return Math.min(Math.max(sourceOffset - directStart, 0), rendered.length);
  const decoded = decodedSource(source);
  const decodedStart = decoded.text.indexOf(rendered);
  if (decodedStart < 0) return null;
  const target = Math.min(Math.max(sourceOffset, 0), source.length);
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset <= rendered.length; offset += 1) {
    const sourceBoundary = decoded.sourceOffsets[decodedStart + offset];
    if (sourceBoundary === undefined) break;
    const candidateDistance = Math.abs(sourceBoundary - target);
    if (candidateDistance < distance) {
      nearest = offset;
      distance = candidateDistance;
    }
  }
  return nearest;
}

function markdownRenderedOffsetToSourceOffset(source: string, rendered: string, renderedOffset: number): number | null {
  let output = '';
  const boundaries = [0];
  let index = 0;
  const append = (value: string, sourceEnd: number) => {
    output += value;
    for (let unit = 0; unit < value.length; unit += 1) boundaries.push(sourceEnd);
  };
  while (index < source.length) {
    if (source[index] === '`' || source.startsWith('**', index) || source.startsWith('__', index)) { index += source.startsWith('**', index) || source.startsWith('__', index) ? 2 : 1; continue; }
    const image = source.startsWith('![', index);
    const link = source[index] === '[';
    if (image || link) {
      const labelStart = index + (image ? 2 : 1);
      const labelEnd = source.indexOf(']', labelStart);
      const destinationEnd = labelEnd >= 0 && source[labelEnd + 1] === '(' ? source.indexOf(')', labelEnd + 2) : (labelEnd >= 0 && source.startsWith('[]', labelEnd + 1) ? labelEnd + 2 : -1);
      if (labelEnd >= 0 && destinationEnd >= 0) {
        if (!image) append(source.slice(labelStart, labelEnd), labelEnd);
        index = image ? destinationEnd + 1 : destinationEnd;
        continue;
      }
    }
    append(source[index], index + 1);
    index += 1;
  }
  const start = output.indexOf(rendered);
  if (start < 0) return null;
  return boundaries[start + Math.min(Math.max(renderedOffset, 0), rendered.length)] ?? null;
}

export function previewCursorToOffset(text: Text, cursor: PreviewCursor): number {
  if (cursor.sourceOffset !== undefined) return Math.min(Math.max(cursor.sourceOffset, 0), text.length);
  const range = sourceRangeToOffsets(text, cursor.sourceRange);
  const sourceText = text.sliceString(range.from, range.to);
  const local = renderedOffsetToSourceOffset(sourceText, cursor.renderedText, cursor.renderedOffset)
    ?? markdownRenderedOffsetToSourceOffset(sourceText, cursor.renderedText, cursor.renderedOffset)
    ?? 0;
  return Math.min(range.from + local, range.to);
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
