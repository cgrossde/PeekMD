import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Text } from '@codemirror/state';
import { parseSourceRange, sourceRangeToOffsets, type PreviewCursor, type SourcePositionRange } from '../lib/sourcePosition';

type MarkdownPreviewProps = {
  html: string;
};

export type MarkdownPreviewHandle = {
  captureCursor(): PreviewCursor | null;
  restoreCursor(source: Text, offset: number): boolean;
};

const INTERACTIVE_SELECTOR = 'a,button,input,select,textarea,summary,[role="button"],[role="link"],[role="checkbox"],[contenteditable="true"],.peekmd-mermaid-controls,.peekmd-mermaid-viewport';

function isInteractiveTarget(target: EventTarget | null, container: HTMLElement): boolean {
  return target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR)) && container.contains(target);
}

function rangeFromPoint(container: HTMLElement, x: number, y: number): Range | null {
  const document = container.ownerDocument;
  const legacy = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint;
  if (legacy) return legacy.call(document, x, y);
  const modern = (document as Document & { caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null }).caretPositionFromPoint;
  const position = modern?.call(document, x, y);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

function textNodes(element: Element): globalThis.Text[] {
  const result: globalThis.Text[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) result.push(node as globalThis.Text);
  return result;
}

function cursorFromRange(range: Range, article: HTMLElement): PreviewCursor | null {
  if (range.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const sourceElement = range.startContainer.parentElement?.closest<HTMLElement>('[data-sourcepos]');
  const sourceRange = parseSourceRange(sourceElement?.getAttribute('data-sourcepos') ?? '');
  if (!sourceElement || !sourceRange) return null;
  const walker = article.ownerDocument.createTreeWalker(sourceElement, NodeFilter.SHOW_TEXT);
  let renderedOffset = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === range.startContainer) {
      renderedOffset += range.startOffset;
      break;
    }
    renderedOffset += node.textContent?.length ?? 0;
  }
  return { sourceRange, renderedText: sourceElement.textContent ?? '', renderedOffset };
}

function domPointForSourceOffset(article: HTMLElement, source: Text, offset: number): { node: globalThis.Text; offset: number } | null {
  const candidates = Array.from(article.querySelectorAll<HTMLElement>('[data-sourcepos]'))
    .map(element => ({ element, range: parseSourceRange(element.getAttribute('data-sourcepos') ?? '') }))
    .filter((entry): entry is { element: HTMLElement; range: SourcePositionRange } => entry.range !== null)
    .map(entry => ({ ...entry, offsets: sourceRangeToOffsets(source, entry.range) }))
    .filter(entry => offset >= entry.offsets.from && offset <= entry.offsets.to)
    .sort((a, b) => (a.offsets.to - a.offsets.from) - (b.offsets.to - b.offsets.from));
  for (const candidate of candidates) {
    const nodes = textNodes(candidate.element);
    if (nodes.length === 0) continue;
    const sourceText = source.sliceString(candidate.offsets.from, candidate.offsets.to);
    const renderedText = candidate.element.textContent ?? '';
    const renderedStart = sourceText.indexOf(renderedText);
    const local = renderedStart >= 0 ? offset - candidate.offsets.from - renderedStart : 0;
    const node = nodes[0];
    return { node, offset: Math.min(Math.max(local, 0), node.data.length) };
  }
  return null;
}

export const MarkdownPreview = forwardRef<MarkdownPreviewHandle, MarkdownPreviewProps>(function MarkdownPreview({ html }, ref) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const caretRangeRef = useRef<Range | null>(null);
  const cursorRef = useRef<PreviewCursor | null>(null);
  const frameRef = useRef<number | null>(null);

  const hideCaret = () => {
    caretRangeRef.current = null;
    cursorRef.current = null;
    if (caretRef.current) caretRef.current.hidden = true;
  };

  const positionCaret = () => {
    frameRef.current = null;
    const caret = caretRef.current;
    const range = caretRangeRef.current;
    const surface = surfaceRef.current;
    if (!caret || !range || !surface) {
      hideCaret();
      return;
    }
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    caret.style.left = `${rect.left - surfaceRect.left}px`;
    caret.style.top = `${rect.top - surfaceRect.top}px`;
    caret.style.height = `${Math.max(rect.height, 16)}px`;
    caret.hidden = false;
  };

  const scheduleCaretPosition = () => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(positionCaret);
  };

  const applyRange = (range: Range, article: HTMLElement): boolean => {
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    caretRangeRef.current = range;
    cursorRef.current = cursorFromRange(range, article);
    scheduleCaretPosition();
    return true;
  };

  useImperativeHandle(ref, () => ({
    captureCursor: () => cursorRef.current,
    restoreCursor: (source, offset) => {
      const article = articleRef.current;
      const point = article ? domPointForSourceOffset(article, source, offset) : null;
      if (!article || !point) return false;
      const range = article.ownerDocument.createRange();
      range.setStart(point.node, point.offset);
      range.collapse(true);
      if (!applyRange(range, article)) return false;
      if (cursorRef.current) cursorRef.current = { ...cursorRef.current, sourceOffset: offset };
      return true;
    },
  }), []);

  useEffect(() => {
    const article = articleRef.current;
    const surface = surfaceRef.current;
    if (!article || !surface) return;

    const onClick = (event: MouseEvent) => {
      if (isInteractiveTarget(event.target, article)) {
        hideCaret();
        return;
      }
      event.preventDefault();
      const range = rangeFromPoint(article, event.clientX, event.clientY);
      if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) {
        window.getSelection()?.removeAllRanges();
        hideCaret();
        return;
      }
      range.collapse(true);
      applyRange(range, article);
    };

    const onMouseUp = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && article.contains(selection.anchorNode) && article.contains(selection.focusNode)) hideCaret();
    };

    const onSurfaceClick = (event: MouseEvent) => {
      if (event.target === surface) {
        window.getSelection()?.removeAllRanges();
        hideCaret();
      }
    };

    article.addEventListener('click', onClick);
    article.addEventListener('mouseup', onMouseUp);
    surface.addEventListener('click', onSurfaceClick);
    return () => {
      article.removeEventListener('click', onClick);
      article.removeEventListener('mouseup', onMouseUp);
      surface.removeEventListener('click', onSurfaceClick);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  useEffect(() => {
    const onLayout = () => { if (caretRangeRef.current) scheduleCaretPosition(); };
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, []);

  return (
    <div className="peekmd-preview-surface" ref={surfaceRef}>
      <article ref={articleRef} className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      <div ref={caretRef} className="peekmd-preview-caret" aria-hidden="true" hidden />
    </div>
  );
});
