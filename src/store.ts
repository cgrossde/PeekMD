import { create } from 'zustand';
import { Text } from '@codemirror/state';
import { invoke } from '@tauri-apps/api/core';
import { loadState } from './lib/persistence';
import { flipTheme } from './lib/theme';
import { stemName } from './lib/paths';

export type DocId = string;
export type Heading = { id: string; level: number; text: string };
export type FileRevision = { sha256: string; len: number; file_id: string };
export type DocumentMeta = { content: string; valid: boolean };
export type Doc = {
  path: DocId;
  title: string;
  html: string;
  meta: DocumentMeta | null;
  headings: Heading[];
  mtime: number;
  revision: FileRevision;
  openedAt: string;
  dirty: boolean;
  removed?: boolean;
};
export type RenderedDoc = { html: string; title: string; path: string; meta: DocumentMeta | null; headings: Heading[]; mtime: number; revision: FileRevision; local_images: string[] };
export type EditableDocument = { source: string; line_separator: string; document: RenderedDoc };
export type MarkdownSaveConflict = 'revision_changed' | 'file_replaced' | 'concurrent_write';
export type MarkdownSaveResult =
  | { status: 'updated'; document: RenderedDoc }
  | { status: 'conflict'; latest: EditableDocument; reason: MarkdownSaveConflict };
export type EditStatus = 'clean' | 'dirty' | 'saving' | 'conflict' | 'error';
export type EditSession = {
  path: DocId;
  draft: Text;
  lineSeparator: string;
  baseRevision: FileRevision;
  status: EditStatus;
  resetGeneration: number;
  latest?: EditableDocument;
  message?: string;
};
export type RecentEntry = { path: string; title: string; viewedAt: string };
export type UiState = {
  sidebarVisible: boolean;
  tocVisible: boolean;
  themeOverride: 'light' | 'dark' | null;
  paletteOpen: boolean;
  findOpen: boolean;
  shortcutsOpen: boolean;
};

type TaskEditResult = { status: 'updated' | 'conflict'; document: RenderedDoc; reason?: string };

const MAX_OPEN_DOCS = 10;
const MAX_RECENTLY_VIEWED = 20;
const MIN_OPEN_AGE_MS = 5 * 24 * 60 * 60 * 1000;
let editTimer: ReturnType<typeof setTimeout> | undefined;
let editSaveInFlight: Promise<boolean> | null = null;
let reconcilePending = false;
let navigationInFlight: Promise<boolean> | null = null;

function isOlderThanMinimumOpenAge(openedAt: string, now: number): boolean {
  return now - new Date(openedAt).getTime() > MIN_OPEN_AGE_MS;
}

function pruneOpenDocs(openDocs: Doc[], activeDocId: DocId | null, recentlyViewed: RecentEntry[], now: number) {
  const excess = openDocs.length - MAX_OPEN_DOCS;
  if (excess <= 0) return null;
  const eligible = openDocs.filter(doc => doc.path !== activeDocId && isOlderThanMinimumOpenAge(doc.openedAt, now));
  const moved = eligible.slice(-excess);
  if (moved.length === 0) return null;
  const movedPaths = new Set(moved.map(doc => doc.path));
  const viewedAt = new Date(now).toISOString();
  return {
    openDocs: openDocs.filter(doc => !movedPaths.has(doc.path)),
    recentlyViewed: [...moved.map(doc => ({ path: doc.path, title: doc.title, viewedAt })), ...recentlyViewed.filter(entry => !movedPaths.has(entry.path))].slice(0, MAX_RECENTLY_VIEWED),
    movedPaths,
  };
}

function sameRevision(a: FileRevision, b: FileRevision): boolean {
  return a.sha256 === b.sha256 && a.len === b.len && a.file_id === b.file_id;
}

function textFromSource(source: string): Text {
  return Text.of(source.split(/\r\n?|\n/));
}

function sourceFromText(draft: Text, lineSeparator: string): string {
  return draft.sliceString(0, draft.length, lineSeparator);
}

export type StoreState = {
  openDocs: Doc[];
  activeDocId: DocId | null;
  recentlyViewed: RecentEntry[];
  lastError: string | null;
  infoToast: string | null;
  ui: UiState;
  navBack: DocId[];
  navForward: DocId[];
  editSession: EditSession | null;
  editLoadingPath: DocId | null;
  openFile: (path: string, options?: { pushHistory?: boolean; activate?: boolean; prepend?: boolean; openedAt?: string; prune?: boolean }) => Promise<void>;
  openMany: (paths: string[]) => Promise<void>;
  activate: (id: DocId, options?: { pushHistory?: boolean; updateOpenedAt?: boolean }) => Promise<boolean>;
  close: (id: DocId) => Promise<boolean>;
  closeOthers: (id: DocId) => Promise<boolean>;
  reopenViewed: (path: string) => Promise<void>;
  pruneOpenDocuments: () => void;
  removeViewed: (path: string) => void;
  navigateBack: () => Promise<boolean>;
  navigateForward: () => Promise<boolean>;
  markDirty: (path: string, mtime: number) => Promise<void>;
  markRemoved: (path: string) => void;
  handleDetachedClosed: (path: string) => void;
  refreshActive: () => Promise<void>;
  setTaskChecked: (path: string, taskLine: number, taskColumn: number, expectedRevision: FileRevision, checked: boolean) => Promise<boolean>;
  beginEditing: () => Promise<boolean>;
  updateEditDraft: (draft: Text) => void;
  saveEdit: () => Promise<boolean>;
  finishEditing: () => Promise<boolean>;
  reloadEditFromDisk: () => void;
  overwriteEdit: () => Promise<boolean>;
  retryEditSave: () => Promise<boolean>;
  setSidebar: (visible: boolean) => void;
  setToc: (visible: boolean) => void;
  setThemeOverride: (t: 'light' | 'dark' | null) => void;
  toggleTheme: () => void;
  setPalette: (open: boolean) => void;
  setFind: (open: boolean) => void;
  setShortcuts: (open: boolean) => void;
  clearError: () => void;
  setInfoToast: (msg: string | null) => void;
  hydrateFromDisk: () => Promise<Record<string, number>>;
};

export const useStore = create<StoreState>()((set, get) => {
  const mergeDocument = (path: string, document: RenderedDoc, guardRevision?: FileRevision): boolean => {
    let committed = false;
    set(s => {
      const current = s.openDocs.find(d => d.path === path);
      if (!current || (guardRevision && !sameRevision(current.revision, guardRevision) && !sameRevision(current.revision, document.revision))) return s;
      return { openDocs: s.openDocs.map(d => d.path === path ? { ...d, html: document.html, title: document.title, meta: document.meta, headings: document.headings, mtime: document.mtime, revision: document.revision, dirty: false, removed: false } : d) };
    });
    if (committed) void invoke('watch_images', { md: path, images: document.local_images }).catch(() => {});
    return committed;
  };

  const scheduleEditSave = () => {
    if (editTimer) clearTimeout(editTimer);
    editTimer = setTimeout(() => { editTimer = undefined; void get().saveEdit(); }, 500);
  };

  const reconcileEditedPath = async (path: string, mtime: number) => {
    const before = get().editSession;
    if (!before || before.path !== path) return;
    const capturedStatus = before.status;
    const capturedRevision = before.baseRevision;
    const capturedDraft = before.draft;
    try {
      const latest = await invoke<EditableDocument>('read_markdown_source', { path });
      const current = get().editSession;
      if (!current || current.path !== path || !sameRevision(current.baseRevision, capturedRevision) || current.resetGeneration !== before.resetGeneration) return;
      mergeDocument(path, latest.document);
      const unchanged = capturedDraft.eq(current.draft);
      if (sameRevision(latest.document.revision, capturedRevision)) return;
      if (capturedStatus === 'clean' && current.status === 'clean' && unchanged) {
        set(s => s.editSession && s.editSession.path === path ? { editSession: { ...s.editSession, draft: textFromSource(latest.source), lineSeparator: latest.line_separator, baseRevision: latest.document.revision, resetGeneration: s.editSession.resetGeneration + 1, latest: undefined, message: undefined } } : s);
      } else {
        set(s => s.editSession && s.editSession.path === path ? { editSession: { ...s.editSession, latest, baseRevision: latest.document.revision, status: 'conflict', message: 'File changed on disk. Autosave paused.' } } : s);
      }
    } catch (err) {
      const current = get().editSession;
      if (!current || current.path !== path || !sameRevision(current.baseRevision, capturedRevision) || current.resetGeneration !== before.resetGeneration) return;
      set({ lastError: `Refresh failed: ${err}` });
      if (capturedStatus !== 'clean') set(s => s.editSession?.path === path ? { editSession: { ...s.editSession, status: 'error', message: 'Could not save changes. Autosave paused.' } } : s);
    }
    void mtime;
  };

  return {
    openDocs: [], activeDocId: null, recentlyViewed: [], lastError: null, infoToast: null,
    ui: { sidebarVisible: true, tocVisible: true, themeOverride: null, paletteOpen: false, findOpen: false, shortcutsOpen: false },
    navBack: [], navForward: [], editSession: null, editLoadingPath: null,

    openFile: async (path, options) => {
      const editingPath = get().editSession?.path;
      if (editingPath && editingPath !== path && !(await get().finishEditing())) return;
      const pushHistory = options?.pushHistory ?? true;
      const doActivate = options?.activate ?? true;
      const { openDocs } = get();
      set(s => ({ recentlyViewed: s.recentlyViewed.filter(r => r.path !== path) }));
      if (openDocs.find(d => d.path === path)) { if (doActivate) await get().activate(path, { pushHistory }); return; }
      const r = await invoke<RenderedDoc>('render_markdown', { path });
      const doc: Doc = { path, title: r.title, html: r.html, meta: r.meta, headings: r.headings, mtime: r.mtime, revision: r.revision, openedAt: options?.openedAt ?? new Date().toISOString(), dirty: false, removed: false };
      set(s => ({ openDocs: options?.prepend === false ? [...s.openDocs, doc] : [doc, ...s.openDocs] }));
      if (options?.prune !== false) get().pruneOpenDocuments();
      void invoke('watch_paths', { paths: [path] }).catch((err: unknown) => set({ lastError: `Watch failed: ${err}` }));
      if (r.local_images.length > 0) void invoke('watch_images', { md: path, images: r.local_images }).catch(() => {});
      if (doActivate) await get().activate(path, { pushHistory });
    },

    openMany: async (paths) => {
      if (paths.length === 0) return;
      const errors: string[] = [];
      for (const p of paths) { try { await get().openFile(p); } catch (err) { errors.push(`${p.split('/').pop() ?? p}: ${err instanceof Error ? err.message : String(err)}`); } }
      if (errors.length > 0) set({ lastError: errors.join('\n') });
      const active = get().activeDocId;
      const opened = paths.filter(p => get().openDocs.some(d => d.path === p));
      if (opened.length > 0 && !opened.includes(active ?? '')) await get().activate(opened[0]);
    },

    activate: async (id, opts) => {
      if (get().activeDocId !== id && get().editSession?.path === get().activeDocId && !(await get().finishEditing())) return false;
      const { activeDocId, navBack, openDocs } = get();
      const pushHistory = opts?.pushHistory !== false;
      const updateOpenedAt = opts?.updateOpenedAt !== false && activeDocId !== id;
      const navigatedAt = updateOpenedAt ? new Date().toISOString() : undefined;
      const wasDirty = openDocs.find(d => d.path === id)?.dirty === true;
      set(s => ({ activeDocId: id, openDocs: s.openDocs.map(d => d.path === id ? { ...d, ...(navigatedAt ? { openedAt: navigatedAt } : {}), dirty: false } : d), navBack: pushHistory && activeDocId && activeDocId !== id ? [...navBack, activeDocId] : s.navBack, navForward: pushHistory ? [] : s.navForward }));
      if (wasDirty) void get().refreshActive().catch((err: unknown) => set({ lastError: `Refresh failed: ${err}` }));
      return true;
    },

    close: async (id) => {
      if (get().activeDocId === id && get().editSession?.path === id && !(await get().finishEditing())) return false;
      const { openDocs, activeDocId, recentlyViewed } = get();
      const doc = openDocs.find(d => d.path === id);
      if (!doc) return true;
      const newRecents = [{ path: doc.path, title: doc.title, viewedAt: new Date().toISOString() }, ...recentlyViewed].slice(0, MAX_RECENTLY_VIEWED);
      const newDocs = openDocs.filter(d => d.path !== id);
      let newActive: DocId | null = activeDocId;
      if (activeDocId === id) { const idx = openDocs.findIndex(d => d.path === id); newActive = newDocs[idx]?.path ?? newDocs[idx - 1]?.path ?? null; }
      void invoke('unwatch', { path: id }).catch(() => {});
      void invoke('unwatch_images', { md: id }).catch(() => {});
      set(s => ({ openDocs: newDocs, activeDocId: newActive, recentlyViewed: newRecents, navBack: s.navBack.filter(p => p !== id), navForward: s.navForward.filter(p => p !== id) }));
      return true;
    },

    closeOthers: async (id) => {
      if (get().editSession?.path === get().activeDocId && get().activeDocId !== id && !(await get().finishEditing())) return false;
      const paths = get().openDocs.filter(d => d.path !== id).map(d => d.path);
      for (const path of paths) await get().close(path);
      return true;
    },

    reopenViewed: async (path) => { await get().openFile(path); },
    pruneOpenDocuments: () => {
      const { openDocs, activeDocId, recentlyViewed } = get();
      const pruned = pruneOpenDocs(openDocs, activeDocId, recentlyViewed, Date.now());
      if (!pruned) return;
      set({ openDocs: pruned.openDocs, recentlyViewed: pruned.recentlyViewed });
      for (const movedPath of pruned.movedPaths) { void invoke('unwatch', { path: movedPath }).catch(() => {}); void invoke('unwatch_images', { md: movedPath }).catch(() => {}); }
    },
    removeViewed: path => set(s => ({ recentlyViewed: s.recentlyViewed.filter(r => r.path !== path) })),

    navigateBack: async () => {
      if (navigationInFlight) return navigationInFlight;
      const operation = (async () => {
        const { navBack, activeDocId, navForward } = get();
        if (navBack.length === 0) return false;
        const prev = navBack[navBack.length - 1];
        if (!(await get().activate(prev, { pushHistory: false }))) return false;
        set({ navBack: navBack.slice(0, -1), navForward: activeDocId ? [activeDocId, ...navForward] : navForward });
        return true;
      })();
      navigationInFlight = operation;
      try { return await operation; } finally { if (navigationInFlight === operation) navigationInFlight = null; }
    },
    navigateForward: async () => {
      if (navigationInFlight) return navigationInFlight;
      const operation = (async () => {
        const { navForward, activeDocId, navBack } = get();
        if (navForward.length === 0) return false;
        const next = navForward[0];
        if (!(await get().activate(next, { pushHistory: false }))) return false;
        set({ navForward: navForward.slice(1), navBack: activeDocId ? [...navBack, activeDocId] : navBack });
        return true;
      })();
      navigationInFlight = operation;
      try { return await operation; } finally { if (navigationInFlight === operation) navigationInFlight = null; }
    },

    markDirty: async (path, mtime) => {
      if (path === get().activeDocId && get().editSession?.path === path) {
        if (editSaveInFlight) { reconcilePending = true; return; }
        await reconcileEditedPath(path, mtime);
        const after = get();
        if (after.editSession?.path === path) return;
        if (after.activeDocId === path) {
          try { const r = await invoke<RenderedDoc>('render_markdown', { path }); mergeDocument(path, r); } catch { /* keep old render */ }
        } else {
          set(s => ({ openDocs: s.openDocs.map(d => d.path === path ? { ...d, dirty: true, mtime } : d) }));
        }
        return;
      }
      if (path === get().activeDocId) {
        try { const r = await invoke<RenderedDoc>('render_markdown', { path }); mergeDocument(path, r); } catch { /* keep old render */ }
      } else set(s => ({ openDocs: s.openDocs.map(d => d.path === path ? { ...d, dirty: true, mtime } : d) }));
    },

    markRemoved: path => set(s => ({ openDocs: s.openDocs.map(d => d.path === path ? { ...d, removed: true } : d) })),
    handleDetachedClosed: path => {
      void invoke('unwatch', { path }).catch(() => {});
      const { openDocs, recentlyViewed } = get();
      if (openDocs.some(d => d.path === path) || recentlyViewed.some(r => r.path === path)) return;
      set(s => ({ recentlyViewed: [{ path, title: stemName(path), viewedAt: new Date().toISOString() }, ...s.recentlyViewed].slice(0, MAX_RECENTLY_VIEWED) }));
    },
    refreshActive: async () => {
      const path = get().activeDocId;
      if (!path) return;
      if (get().editSession?.path === path) { await reconcileEditedPath(path, Date.now()); return; }
      const r = await invoke<RenderedDoc>('render_markdown', { path });
      mergeDocument(path, r);
    },

    setTaskChecked: async (path, taskLine, taskColumn, expectedRevision, checked) => {
      try {
        const result = await invoke<TaskEditResult>('set_task_checked', { path, taskLine, taskColumn, expectedRevision, checked });
        mergeDocument(path, result.document, expectedRevision);
        if (result.status === 'conflict') { set({ lastError: 'The file changed during the checkbox update. Reloaded the latest content without retrying.' }); return false; }
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try { const document = await invoke<RenderedDoc>('render_markdown', { path }); mergeDocument(path, document, expectedRevision); } catch { /* watcher can reconcile */ }
        set({ lastError: `Checkbox update could not be confirmed: ${message}` });
        return false;
      }
    },

    beginEditing: async () => {
      const path = get().activeDocId;
      if (!path) return false;
      if (get().editSession?.path === path) return true;
      if (get().editLoadingPath === path) return false;
      set({ editLoadingPath: path });
      try {
        const editable = await invoke<EditableDocument>('read_markdown_source', { path });
        if (get().activeDocId !== path) return false;
        mergeDocument(path, editable.document);
        set({ editSession: { path, draft: textFromSource(editable.source), lineSeparator: editable.line_separator, baseRevision: editable.document.revision, status: 'clean', resetGeneration: 0 }, lastError: null });
        return true;
      } catch (err) {
        set({ lastError: `Could not open Markdown source: ${err}` });
        return false;
      } finally { if (get().editLoadingPath === path) set({ editLoadingPath: null }); }
    },

    updateEditDraft: draft => {
      const session = get().editSession;
      if (!session) return;
      const changed = !draft.eq(session.draft);
      const status = changed && ['clean', 'dirty', 'saving'].includes(session.status) ? 'dirty' : session.status;
      set({ editSession: { ...session, draft, status } });
      if (changed && ['clean', 'dirty', 'saving'].includes(session.status)) scheduleEditSave();
    },

    saveEdit: async () => {
      if (editSaveInFlight) return editSaveInFlight;
      const session = get().editSession;
      if (!session || session.status === 'clean') return !session || session.status === 'clean';
      if (session.status === 'conflict' || session.status === 'error') return false;
      const savedDraft = session.draft;
      const path = session.path;
      const generation = session.resetGeneration;
      const source = sourceFromText(savedDraft, session.lineSeparator);
      set(s => s.editSession?.path === path && s.editSession.resetGeneration === generation ? { editSession: { ...s.editSession, status: 'saving', message: undefined } } : s);
      editSaveInFlight = (async () => {
        try {
          const result = await invoke<MarkdownSaveResult>('save_markdown_source', { path, source, expectedRevision: session.baseRevision });
          const current = get().editSession;
          if (!current || current.path !== path || current.resetGeneration !== generation) return true;
          if (result.status === 'updated') {
            mergeDocument(path, result.document);
            const stillCurrent = get().editSession;
            if (stillCurrent?.path !== path || stillCurrent.resetGeneration !== generation) return true;
            const clean = stillCurrent.draft.eq(savedDraft);
            set({ editSession: { ...stillCurrent, baseRevision: result.document.revision, status: clean ? 'clean' : 'dirty', message: undefined } });
            if (!clean) scheduleEditSave();
            return true;
          }
          mergeDocument(path, result.latest.document);
          set(s => s.editSession?.path === path && s.editSession.resetGeneration === generation ? { editSession: { ...s.editSession, latest: result.latest, baseRevision: result.latest.document.revision, status: 'conflict', message: 'File changed on disk. Autosave paused.' } } : s);
          return false;
        } catch (err) {
          set(s => s.editSession?.path === path && s.editSession.resetGeneration === generation ? { editSession: { ...s.editSession, status: 'error', message: 'Could not save changes. Autosave paused.' } } : s);
          set({ lastError: `Save failed: ${err}` });
          return false;
        } finally {
          editSaveInFlight = null;
          if (reconcilePending) { reconcilePending = false; void get().markDirty(path, Date.now()); }
        }
      })();
      return editSaveInFlight;
    },

    finishEditing: async () => {
      if (!get().editSession) return true;
      clearTimeout(editTimer);
      editTimer = undefined;
      while (editSaveInFlight) await editSaveInFlight;
      while (get().editSession?.status === 'dirty') {
        if (!(await get().saveEdit())) return false;
        while (editSaveInFlight) await editSaveInFlight;
      }
      const session = get().editSession;
      if (!session) return true;
      if (session.status !== 'clean') return false;
      set({ editSession: null });
      return true;
    },
    reloadEditFromDisk: () => {
      const session = get().editSession;
      if (!session?.latest) return;
      const latest = session.latest;
      set({ editSession: { ...session, draft: textFromSource(latest.source), lineSeparator: latest.line_separator, baseRevision: latest.document.revision, status: 'clean', resetGeneration: session.resetGeneration + 1, latest: undefined, message: undefined } });
    },
    overwriteEdit: async () => {
      const session = get().editSession;
      if (!session?.latest) return false;
      set({ editSession: { ...session, baseRevision: session.latest.document.revision, status: 'dirty', message: undefined } });
      return get().saveEdit();
    },
    retryEditSave: async () => {
      const session = get().editSession;
      if (!session || session.status !== 'error') return false;
      set({ editSession: { ...session, status: 'dirty', message: undefined } });
      return get().saveEdit();
    },

    setSidebar: visible => set(s => ({ ui: { ...s.ui, sidebarVisible: visible } })),
    setToc: visible => set(s => ({ ui: { ...s.ui, tocVisible: visible } })),
    setThemeOverride: t => set(s => ({ ui: { ...s.ui, themeOverride: t } })),
    toggleTheme: () => set(s => ({ ui: { ...s.ui, themeOverride: flipTheme(s.ui.themeOverride) } })),
    setPalette: open => set(s => ({ ui: { ...s.ui, paletteOpen: open } })),
    setFind: open => set(s => ({ ui: { ...s.ui, findOpen: open } })),
    setShortcuts: open => set(s => ({ ui: { ...s.ui, shortcutsOpen: open, ...(open ? { paletteOpen: false, findOpen: false } : {}) } })),
    clearError: () => set({ lastError: null }),
    setInfoToast: msg => set({ infoToast: msg }),

    hydrateFromDisk: async () => {
      const persisted = await loadState();
      if (!persisted) return {};
      set(s => ({ ui: { ...s.ui, ...persisted.ui, paletteOpen: false, findOpen: false, shortcutsOpen: false }, recentlyViewed: persisted.recentlyViewed }));
      const validPaths: string[] = [];
      for (const p of persisted.openDocs) {
        try { await get().openFile(p, { pushHistory: false, activate: false, prepend: false, openedAt: persisted.openedAt[p] ?? new Date().toISOString(), prune: false }); validPaths.push(p); } catch { /* missing file */ }
      }
      if (get().activeDocId === null && persisted.activeDoc && validPaths.includes(persisted.activeDoc)) await get().activate(persisted.activeDoc, { pushHistory: false, updateOpenedAt: false });
      get().pruneOpenDocuments();
      set({ navBack: [], navForward: [] });
      if (persisted.openDocs.length > validPaths.length) set({ infoToast: `${persisted.openDocs.length - validPaths.length} file(s) missing from last session` });
      return persisted.scrollPositions;
    },
  };
});
