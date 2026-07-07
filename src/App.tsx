import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { EmptyState } from './components/EmptyState';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { TOC } from './components/TOC';
import { CommandPalette } from './components/CommandPalette';
import { FindBar } from './components/FindBar';
import { Toast } from './components/Toast';
import { SkillPrompt, checkSkillPrompt } from './components/SkillPrompt';
import { useStore } from './store';
import { installGlobalKeybindings } from './lib/keybindings';
import { initWatcher } from './lib/watcher';
import { installMdLinkHandler } from './lib/mdLinks';
import { scheduleSave, type Persisted } from './lib/persistence';
import { applyTheme, resolveTheme, watchSystemTheme } from './lib/theme';
import { resolveMarkdownImages } from './lib/mdImages';
import { hydrateMermaid } from './lib/mermaid';
import { useSidebarResize } from './lib/sidebarResize';

// Module-level flag: survives HMR re-renders so hydrateFromDisk only runs once.
let didHydrate = false;

// Detect whether this window was opened as a detached single-doc view.
const detachedPath = new URLSearchParams(window.location.search).get('detached');
const isDetached = detachedPath !== null;

export default function App() {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSkillPrompt, setShowSkillPrompt] = useState(false);

  const docViewRef = useRef<HTMLDivElement>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const { onMouseDown: onResizeHandleMouseDown } = useSidebarResize(mainAreaRef);
  // Per-doc scroll positions, keyed by path. Saved before switching away,
  // restored after the new doc's HTML is committed to the DOM.
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const prevDocIdRef = useRef<string | null>(null);
  const buildSnapshotRef = useRef<(() => Persisted) | null>(null);
  const sidebarVisible = useStore(s => s.ui.sidebarVisible);
  const activeDoc = useStore(s => s.openDocs.find(d => d.path === s.activeDocId));
  const openDocs = useStore(s => s.openDocs);
  const themeOverride = useStore(s => s.ui.themeOverride);

  const pickFile = useCallback(async () => {
    const picked = await openDialog({
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
      multiple: true,
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    if (paths.length > 0) await useStore.getState().openMany(paths);
  }, []);

  // One-time setup: hydrate store, install keybindings, start watcher, md-link handler, persistence
  useEffect(() => {
    if (isDetached) {
      // Detached windows open exactly the file in the URL — skip full hydration.
      void useStore.getState().openFile(decodeURIComponent(detachedPath!));
      useStore.getState().setSidebar(false);
    } else if (!didHydrate) {
      didHydrate = true;
      useStore.getState().hydrateFromDisk().then((positions) => {
        for (const [path, top] of Object.entries(positions)) {
          scrollPositions.current.set(path, top);
        }
      });
      // Check once whether an agent is installed but the skill is missing.
      // Only prompt in the main window, not in detached doc windows.
      void checkSkillPrompt().then(needed => { if (needed) setShowSkillPrompt(true); });
    }

    const cleanupKeys = installGlobalKeybindings();
    const cleanupWatcher = initWatcher(() => docViewRef.current);
    const cleanupLinks = installMdLinkHandler();

    // Theme sync: ui.themeOverride (persisted) is the single source of truth.
    // Re-apply whenever it changes (user toggle, or hydrateFromDisk restoring
    // it) and whenever the system preference changes while following it.
    applyTheme(useStore.getState().ui.themeOverride);
    const unsubTheme = useStore.subscribe((state, prev) => {
      if (state.ui.themeOverride !== prev.ui.themeOverride) applyTheme(state.ui.themeOverride);
    });
    const unsubSystemTheme = watchSystemTheme(() => {
      if (useStore.getState().ui.themeOverride === null) applyTheme(null);
    });

    // Persistence — detached windows must not overwrite main-window state.json.
    let unsubPersist: (() => void) | null = null;
    if (!isDetached) {
      const buildSnapshot = () => {
        const s = useStore.getState();
        return {
          version: 2 as const,
          openDocs: s.openDocs.map(d => d.path),
          activeDoc: s.activeDocId,
          rightPaneDoc: null as null,
          recentlyClosed: s.recentlyClosed,
          scrollPositions: Object.fromEntries(scrollPositions.current),
          ui: {
            sidebarVisible: s.ui.sidebarVisible,
            tocVisible: s.ui.tocVisible,
            themeOverride: s.ui.themeOverride,
          },
        };
      };
      buildSnapshotRef.current = buildSnapshot;
      unsubPersist = useStore.subscribe(() => scheduleSave(buildSnapshot));
    }

    return () => {
      cleanupKeys(); cleanupWatcher(); cleanupLinks();
      unsubTheme(); unsubSystemTheme();
      unsubPersist?.();
    };
  }, []);

  // Save the outgoing doc's scroll position, restore the incoming doc's.
  // useLayoutEffect fires after React commits new HTML, before the browser paints.
  useLayoutEffect(() => {
    const c = docViewRef.current;
    if (!c) return;
    const incoming = activeDoc?.path ?? null;
    const outgoing = prevDocIdRef.current;
    if (outgoing && outgoing !== incoming) {
      scrollPositions.current.set(outgoing, c.scrollTop);
      // Persist immediately — no Zustand change will fire to trigger the subscriber.
      if (buildSnapshotRef.current) scheduleSave(buildSnapshotRef.current);
    }
    c.scrollTop = scrollPositions.current.get(incoming ?? '') ?? 0;
    prevDocIdRef.current = incoming;
  }, [activeDoc?.path]);

  // Rewrite <img> src to loadable asset URLs after every render of this doc
  // (initial open, doc switch, and every live-reload re-render).
  useLayoutEffect(() => {
    const c = docViewRef.current;
    if (!c || !activeDoc) return;
    resolveMarkdownImages(c, activeDoc.path);
  }, [activeDoc?.path, activeDoc?.html]);

  // Hydrate Mermaid diagrams whenever the active doc or theme changes.
  useLayoutEffect(() => {
    const c = docViewRef.current;
    if (!c || !activeDoc) return;
    const theme = resolveTheme(themeOverride);
    void hydrateMermaid(c, theme);
  }, [activeDoc?.path, activeDoc?.html, themeOverride]);

  // Initial path — CLI arg / Open With / Finder double-click (main window only)
  useEffect(() => {
    if (isDetached) return; // detached window opens from URL param, not IPC
    const promise = getCurrentWebview().listen<{ paths: string[] }>('peekmd://open-files', (e) => {
      if (e.payload.paths.length) void useStore.getState().openMany(e.payload.paths);
    });
    void invoke<string[]>('take_pending_paths').then((paths) => {
      if (paths.length) void useStore.getState().openMany(paths);
    });
    return () => { void promise.then((un) => un()); };
  }, []);

  // A detached (doc-<uuid>) window closed — release its file-watcher
  // reference and, if the doc isn't open here either, restore it to
  // Recently Closed. Main window only: detached windows don't own
  // persistence or Recently Closed.
  useEffect(() => {
    if (isDetached) return;
    const promise = listen<{ path: string }>('detached-window-closed', (e) => {
      useStore.getState().handleDetachedClosed(e.payload.path);
    });
    return () => { void promise.then((un) => un()); };
  }, []);

  // Drag-drop
  useEffect(() => {
    const promise = getCurrentWebview().onDragDropEvent((e) => {
      switch (e.payload.type) {
        case 'enter':
        case 'over':
          setIsDragOver(true);
          break;
        case 'leave':
          setIsDragOver(false);
          break;
        case 'drop': {
          setIsDragOver(false);
          const mdExts = new Set(['md', 'markdown', 'mdown', 'mkd']);
          const mdPaths = e.payload.paths.filter(p => {
            const ext = p.split('.').pop()?.toLowerCase() ?? '';
            return mdExts.has(ext);
          });
          if (mdPaths.length > 0) void useStore.getState().openMany(mdPaths);
          break;
        }
      }
    });
    return () => { void promise.then((un) => un()); };
  }, []);

  return (
    <div className={`peekmd-app${isDragOver ? ' is-drag-over' : ''}`}>
      <TopBar />
      <div className="peekmd-main-area" ref={mainAreaRef}>
        {sidebarVisible && openDocs.length > 0 && <Sidebar onResizeHandleMouseDown={onResizeHandleMouseDown} />}
        <div className="peekmd-doc-area" ref={docViewRef}>
          <FindBar />
          {activeDoc
            ? <article className="markdown-body" dangerouslySetInnerHTML={{ __html: activeDoc.html }} />
            : <EmptyState onPickFile={pickFile} isDragOver={isDragOver} />
          }
          {isDragOver && <div className="peekmd-drop-overlay" aria-hidden />}
        </div>
        <TOC />
      </div>
      <CommandPalette />
      <Toast />
      {showSkillPrompt && <SkillPrompt onDismiss={() => setShowSkillPrompt(false)} />}
    </div>
  );
}
