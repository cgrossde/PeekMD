import { useEffect, useLayoutEffect, useRef, useState, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { EmptyState } from './components/EmptyState';
import { MarkdownEditor, type MarkdownEditorHandle } from './components/MarkdownEditor';
import { MarkdownPreview } from './components/MarkdownPreview';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { TOC } from './components/TOC';
import { CommandPalette } from './components/CommandPalette';
import { FindBar } from './components/FindBar';
import { Toast } from './components/Toast';
import { SkillPrompt, checkSkillPrompt } from './components/SkillPrompt';
import { StatusBar } from './components/StatusBar';
import { useStore } from './store';
import { installGlobalKeybindings } from './lib/keybindings';
import { initWatcher } from './lib/watcher';
import { installMdLinkHandler, navigateMarkdownHref } from './lib/mdLinks';
import { installTaskCheckboxHandler } from './lib/taskCheckboxes';
import { scheduleSave, type Persisted } from './lib/persistence';
import { applyTheme, resolveTheme, watchSystemTheme } from './lib/theme';
import { resolveMarkdownImages } from './lib/mdImages';
import { hydrateMermaid } from './lib/mermaid';
import { useSidebarResize } from './lib/sidebarResize';
import { capturePreviewAnchor, restorePreviewAnchor, type SourceAnchor } from './lib/sourcePosition';
let didHydrate = false;
const detachedPath = new URLSearchParams(window.location.search).get('detached');
const isDetached = detachedPath !== null;

export default function App() {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSkillPrompt, setShowSkillPrompt] = useState(false);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const docViewRef = useRef<HTMLDivElement>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const sourceAnchors = useRef<Map<string, SourceAnchor>>(new Map());
  const editorCursors = useRef<Map<string, number>>(new Map());
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const prevDocIdRef = useRef<string | null>(null);
  const prevEditingRef = useRef(false);
  const buildSnapshotRef = useRef<(() => Persisted) | null>(null);
  const { onMouseDown: onResizeHandleMouseDown } = useSidebarResize(mainAreaRef);
  const sidebarVisible = useStore(s => s.ui.sidebarVisible);
  const openDocs = useStore(s => s.openDocs);
  const activeDoc = useStore(s => s.openDocs.find(d => d.path === s.activeDocId));
  const themeOverride = useStore(s => s.ui.themeOverride);
  const editSession = useStore(s => s.editSession);
  const isEditing = Boolean(activeDoc && editSession?.path === activeDoc.path);

  const toggleEditMode = useCallback(async (): Promise<boolean> => {
    const state = useStore.getState();
    const path = state.activeDocId;
    if (!path) return false;
    if (state.editSession?.path === path) {
      const anchor = editorRef.current?.captureAnchor();
      if (anchor) sourceAnchors.current.set(path, anchor);
      const cursor = editorRef.current?.captureCursor();
      if (cursor !== undefined) editorCursors.current.set(path, cursor);
      return state.finishEditing();
    }
    const container = docViewRef.current;
    if (container) sourceAnchors.current.set(path, capturePreviewAnchor(container));
    return state.beginEditing();
  }, []);

  const rememberEditorCursor = useCallback((path: string, position: number) => {
    editorCursors.current.set(path, position);
  }, []);
  const navigateEditorHref = useCallback(async (href: string) => {
    const path = useStore.getState().activeDocId;
    if (!path) return;
    const result = await navigateMarkdownHref(path, href);
    if (result === 'fragment' && await toggleEditMode()) requestAnimationFrame(() => { window.location.hash = href; });
  }, [toggleEditMode]);

  const pickFile = useCallback(async () => {
    const picked = await openDialog({ filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }], multiple: true });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    if (paths.length > 0) await useStore.getState().openMany(paths);
  }, []);

  const handleLinkMouseOver = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>('a[href]');
    if (!link || !event.currentTarget.contains(link)) return;
    const href = link.getAttribute('href');
    if (href) setHoveredLink(href);
  }, []);

  const handleLinkMouseOut = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const related = event.relatedTarget;
    if (related instanceof Node && link.contains(related)) return;
    if (related instanceof Element && related.closest('a[href]') === link) return;
    setHoveredLink(null);
  }, []);

  useEffect(() => { setHoveredLink(null); }, [activeDoc?.path, activeDoc?.html]);

  useEffect(() => {
    if (isDetached) {
      void useStore.getState().openFile(decodeURIComponent(detachedPath!));
      useStore.getState().setSidebar(false);
    } else if (!didHydrate) {
      didHydrate = true;
      void useStore.getState().hydrateFromDisk().then(positions => {
        for (const [path, top] of Object.entries(positions)) scrollPositions.current.set(path, top);
        const c = docViewRef.current;
        const path = useStore.getState().activeDocId;
        if (c && path && !useStore.getState().editSession) c.scrollTop = scrollPositions.current.get(path) ?? 0;
      });
      void checkSkillPrompt().then(needed => { if (needed) setShowSkillPrompt(true); });
    }
    const cleanupKeys = installGlobalKeybindings(toggleEditMode);
    const cleanupWatcher = initWatcher(() => docViewRef.current);
    const cleanupLinks = installMdLinkHandler();
    const cleanupTaskCheckboxes = installTaskCheckboxHandler(() => docViewRef.current);
    applyTheme(useStore.getState().ui.themeOverride);
    const unsubTheme = useStore.subscribe((state, prev) => { if (state.ui.themeOverride !== prev.ui.themeOverride) applyTheme(state.ui.themeOverride); });
    const unsubSystemTheme = watchSystemTheme(() => { if (useStore.getState().ui.themeOverride === null) applyTheme(null); });
    let unsubPersist: (() => void) | null = null;
    if (!isDetached) {
      const buildSnapshot = () => {
        const s = useStore.getState();
        return { version: 2 as const, openDocs: s.openDocs.map(d => d.path), openedAt: Object.fromEntries(s.openDocs.map(d => [d.path, d.openedAt])), activeDoc: s.activeDocId, rightPaneDoc: null as null, recentlyViewed: s.recentlyViewed, scrollPositions: Object.fromEntries(scrollPositions.current), ui: { sidebarVisible: s.ui.sidebarVisible, tocVisible: s.ui.tocVisible, themeOverride: s.ui.themeOverride } };
      };
      buildSnapshotRef.current = buildSnapshot;
      unsubPersist = useStore.subscribe(() => scheduleSave(buildSnapshot));
    }
    const pruneTimer = window.setInterval(() => useStore.getState().pruneOpenDocuments(), 60 * 60 * 1000);
    return () => { cleanupKeys(); cleanupWatcher(); cleanupLinks(); cleanupTaskCheckboxes(); unsubTheme(); unsubSystemTheme(); unsubPersist?.(); window.clearInterval(pruneTimer); };
  }, [toggleEditMode]);

  useLayoutEffect(() => {
    const container = docViewRef.current;
    if (!container) return;
    const incoming = activeDoc?.path ?? null;
    const outgoing = prevDocIdRef.current;
    const wasEditing = prevEditingRef.current;
    if (outgoing && outgoing !== incoming) {
      if (!sourceAnchors.current.has(outgoing) || !wasEditing) {
        scrollPositions.current.set(outgoing, container.scrollTop);
        if (buildSnapshotRef.current) scheduleSave(buildSnapshotRef.current);
      }
    }
    if (incoming && !isEditing) {
      const anchor = sourceAnchors.current.get(incoming);
      if (anchor) restorePreviewAnchor(container, anchor);
      else container.scrollTop = scrollPositions.current.get(incoming) ?? 0;
    }
    prevDocIdRef.current = incoming;
    prevEditingRef.current = isEditing;
  }, [activeDoc?.path, isEditing]);



  useEffect(() => {
    if (!activeDoc) return;
    const path = activeDoc.path;
    let frame = 0;
    const container = docViewRef.current;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!container) return;
        const anchor = isEditing ? editorRef.current?.captureAnchor() : capturePreviewAnchor(container);
        if (anchor) sourceAnchors.current.set(path, anchor);
        if (!isEditing) scrollPositions.current.set(path, container.scrollTop);
      });
    };
    container?.addEventListener('scroll', onScroll, { passive: true });
    return () => { container?.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [isEditing, activeDoc?.path]);

  useLayoutEffect(() => {
    const c = docViewRef.current;
    if (!c || !activeDoc || isEditing) return;
    resolveMarkdownImages(c, activeDoc.path);
  }, [activeDoc?.path, activeDoc?.html, isEditing]);

  useEffect(() => {
    const c = docViewRef.current;
    if (!c || !activeDoc || isEditing) return;
    const theme = resolveTheme(themeOverride);
    const timer = window.setTimeout(() => { void hydrateMermaid(c, theme); }, 250);
    return () => window.clearTimeout(timer);
  }, [activeDoc, themeOverride, isEditing]);

  useEffect(() => {
    if (isDetached) return;
    const promise = getCurrentWebview().listen<{ paths: string[] }>('peekmd://open-files', e => { if (e.payload.paths.length) void useStore.getState().openMany(e.payload.paths); });
    void invoke<string[]>('take_pending_paths').then(paths => { if (paths.length) void useStore.getState().openMany(paths); });
    return () => { void promise.then(un => un()); };
  }, []);

  useEffect(() => {
    if (isDetached) return;
    const promise = listen<{ path: string }>('detached-window-closed', e => { useStore.getState().handleDetachedClosed(e.payload.path); });
    return () => { void promise.then(un => un()); };
  }, []);

  useEffect(() => {
    const promise = getCurrentWebview().onDragDropEvent(e => {
      switch (e.payload.type) {
        case 'enter': case 'over': setIsDragOver(true); break;
        case 'leave': setIsDragOver(false); break;
        case 'drop': {
          setIsDragOver(false);
          const mdExts = new Set(['md', 'markdown', 'mdown', 'mkd']);
          const mdPaths = e.payload.paths.filter(p => mdExts.has(p.split('.').pop()?.toLowerCase() ?? ''));
          if (mdPaths.length > 0) void useStore.getState().openMany(mdPaths);
          break;
        }
      }
    });
    return () => { void promise.then(un => un()); };
  }, []);

  useEffect(() => {
    const windowHandle = getCurrentWindow();
    let destroying = false;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const registration = windowHandle.onCloseRequested(async event => {
      const session = useStore.getState().editSession;
      if (!session || session.status === 'clean' || destroying) return;
      event.preventDefault();
      if (await useStore.getState().finishEditing()) { destroying = true; await windowHandle.destroy(); }
    });
    void registration.then(un => { if (disposed) un(); else unlisten = un; });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  return (
    <div className={`peekmd-app${isDragOver ? ' is-drag-over' : ''}`}>
      <TopBar />
      <div className="peekmd-main-area" ref={mainAreaRef}>
        {sidebarVisible && openDocs.length > 0 && <Sidebar onResizeHandleMouseDown={onResizeHandleMouseDown} />}
        <div className="peekmd-doc-area">
          <div className="peekmd-doc-scroll" ref={docViewRef} onMouseOver={handleLinkMouseOver} onMouseOut={handleLinkMouseOut}>
            {!isEditing && <FindBar />}
            {activeDoc ? (isEditing && editSession ? <MarkdownEditor ref={editorRef} session={editSession} scrollContainer={docViewRef.current} initialAnchor={sourceAnchors.current.get(activeDoc.path)} initialCursor={editorCursors.current.get(activeDoc.path)} onDraftChange={useStore.getState().updateEditDraft} onCursorChange={rememberEditorCursor} onToggle={toggleEditMode} onNavigateHref={navigateEditorHref} onReload={useStore.getState().reloadEditFromDisk} onOverwrite={() => { void useStore.getState().overwriteEdit(); }} onRetry={() => { void useStore.getState().retryEditSave(); }} /> : <MarkdownPreview html={activeDoc.html} />) : <EmptyState onPickFile={pickFile} isDragOver={isDragOver} />}
          </div>
          <StatusBar href={isEditing ? null : hoveredLink} editStatus={isEditing ? editSession?.status : undefined} />
        </div>
        {!isEditing && <TOC />}
      </div>
      <CommandPalette />
      <Toast />
      {showSkillPrompt && <SkillPrompt onDismiss={() => setShowSkillPrompt(false)} />}
    </div>
  );
}
