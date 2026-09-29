import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, type Text, type Range, type Extension } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, syntaxTree, HighlightStyle } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import type { EditSession } from '../store';
import { markdownHrefAt } from '../lib/editorLinks';
import type { SourceAnchor } from '../lib/sourcePosition';

export type MarkdownEditorHandle = {
  captureAnchor(): SourceAnchor;
  captureCursor(): number;
  revealAnchor(anchor: SourceAnchor): void;
  focus(): void;
};

type MarkdownEditorProps = {
  session: EditSession;
  scrollContainer: HTMLElement | null;
  initialAnchor?: SourceAnchor;
  initialCursor?: number;
  onDraftChange(draft: Text): void;
  onCursorChange(path: string, position: number): void;
  onToggle(): void;
  onNavigateHref(href: string): void;
  onReload(): void;
  onOverwrite(): void;
  onRetry(): void;
};

const markdownHighlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: [tags.link, tags.url], color: 'var(--peekmd-editor-link)' },
  { tag: tags.monospace, fontFamily: 'var(--peekmd-editor-mono)' },
  { tag: [tags.processingInstruction, tags.punctuation], color: 'var(--peekmd-editor-muted)' },
  { tag: tags.heading, fontWeight: '700', color: 'var(--peekmd-editor-heading)' },
  { tag: tags.quote, color: 'var(--peekmd-editor-quote)' },
]);

const headingDecorations = ViewPlugin.fromClass(class {
  decorations: ReturnType<typeof Decoration.set>;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: { view: EditorView; docChanged: boolean; viewportChanged: boolean }) {
    if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
  }
  build(view: EditorView) {
    const ranges: Range<Decoration>[] = [];
    const tree = syntaxTree(view.state);
    for (const range of view.visibleRanges) {
      tree.iterate({ from: range.from, to: range.to, enter: (node: { name: string; from: number }) => {
        const match = /^ATXHeading([1-6])$/.exec(node.name) ?? /^SetextHeading([12])$/.exec(node.name);
        if (match) ranges.push(Decoration.line({ class: `peekmd-editor-heading-${match[1]}` }).range(node.from));
      } });
    }
    return Decoration.set(ranges, true);
  }
}, { decorations: value => value.decorations });

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({ session, scrollContainer, initialAnchor, initialCursor, onDraftChange, onCursorChange, onToggle, onNavigateHref, onReload, onOverwrite, onRetry }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const extensionsRef = useRef<Extension[]>([]);
  const extensionFactoryRef = useRef<(lineSeparator: string) => Extension[]>(() => []);
  const generationRef = useRef(session.resetGeneration);

  const reveal = (anchor: SourceAnchor) => {
    const view = viewRef.current;
    if (!view) return;
    const line = Math.min(Math.max(anchor.line, 1), view.state.doc.lines);
    view.requestMeasure({
      read: () => {
        const block = view.lineBlockAt(view.state.doc.line(line).from);
        return block.top;
      },
      write: top => {
        if (!scrollContainer) return;
        const containerTop = scrollContainer.getBoundingClientRect().top;
        scrollContainer.scrollTop += view.documentTop + top - containerTop - anchor.offsetPx;
      },
    });
  };

  useImperativeHandle(ref, () => ({
    captureAnchor: () => {
      const view = viewRef.current;
      if (!view || !scrollContainer) return { line: 1, offsetPx: 0 };
      const containerRect = scrollContainer.getBoundingClientRect();
      const block = view.lineBlockAtHeight(containerRect.top - view.documentTop);
      const line = view.state.doc.lineAt(block.from);
      return { line: line.number, offsetPx: view.documentTop + block.top - containerRect.top };
    },
    captureCursor: () => viewRef.current?.state.selection.main.head ?? 0,
    revealAnchor: reveal,
    focus: () => viewRef.current?.focus(),
  }), [scrollContainer]);

  useEffect(() => {
    if (!hostRef.current) return;
    const buildExtensions = (lineSeparator: string): Extension[] => {
      const updateListener = EditorView.updateListener.of(update => {
        if (update.docChanged) onDraftChange(update.state.doc);
        if (update.selectionSet) onCursorChange(session.path, update.state.selection.main.head);
      });
      return [
        EditorState.lineSeparator.of(lineSeparator), markdown({ base: markdownLanguage }), lineNumbers({ formatNumber: line => String(line) }), history(), syntaxHighlighting(markdownHighlight, { fallback: true }), headingDecorations, EditorView.lineWrapping, updateListener,
        keymap.of([{ key: 'Mod-Enter', run: () => { onToggle(); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.domEventHandlers({
          click: (event, editorView) => {
            if (!event.metaKey) return false;
            const pos = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;
            const href = markdownHrefAt(editorView.state, pos);
            if (!href) return false;
            event.preventDefault();
            onNavigateHref(href);
            return true;
          },
        }),
      ];
    };
    extensionFactoryRef.current = buildExtensions;
    extensionsRef.current = buildExtensions(session.lineSeparator);
    const anchorLine = Math.min(Math.max(initialAnchor?.line ?? 1, 1), session.draft.lines);
    const fallbackCursor = session.draft.line(anchorLine).from;
    const cursor = Math.min(Math.max(initialCursor ?? fallbackCursor, 0), session.draft.length);
    const view = new EditorView({ state: EditorState.create({ doc: session.draft, selection: { anchor: cursor }, extensions: extensionsRef.current }), parent: hostRef.current });
    viewRef.current = view;
    onCursorChange(session.path, cursor);
    if (initialAnchor) reveal(initialAnchor);
    view.focus();
    return () => {
      onCursorChange(session.path, view.state.selection.main.head);
      view.destroy();
      viewRef.current = null;
    };
  }, [onCursorChange, onDraftChange, onNavigateHref, onToggle]);

  useEffect(() => {
    if (generationRef.current === session.resetGeneration) return;
    generationRef.current = session.resetGeneration;
    const view = viewRef.current;
    if (!view) return;
    const cursor = Math.min(Math.max(view.state.selection.main.head, 0), session.draft.length);
    view.setState(EditorState.create({
      doc: session.draft,
      selection: { anchor: cursor },
      extensions: (extensionsRef.current = extensionFactoryRef.current(session.lineSeparator)),
    }));
    view.focus();
  }, [session.resetGeneration, session.draft]);

  const blocked = session.status === 'conflict' || session.status === 'error';
  return (
    <div className="peekmd-editor-shell">
      {blocked && (
        <div className="peekmd-editor-banner" role="alert">
          <span>{session.message}</span>
          {session.status === 'conflict' ? <span className="peekmd-editor-banner-actions"><button type="button" onClick={onReload}>Reload from Disk (Discard Draft)</button><button type="button" onClick={onOverwrite}>Overwrite Disk</button></span> : <button type="button" onClick={onRetry}>Retry</button>}
        </div>
      )}
      <div className="peekmd-editor" ref={hostRef} aria-label="Markdown source editor" />
    </div>
  );
});
