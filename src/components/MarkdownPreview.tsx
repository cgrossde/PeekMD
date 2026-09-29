import { useEffect, useRef } from 'react';

type MarkdownPreviewProps = {
  html: string;
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

export function MarkdownPreview({ html }: MarkdownPreviewProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const caretRangeRef = useRef<Range | null>(null);
  const frameRef = useRef<number | null>(null);

  const hideCaret = () => {
    caretRangeRef.current = null;
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
      const selection = window.getSelection();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
      caretRangeRef.current = range;
      scheduleCaretPosition();
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
}
