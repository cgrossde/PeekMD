import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { loadState } from './lib/persistence';
import { flipTheme } from './lib/theme';
import { stemName } from './lib/paths';

export type DocId = string;
export type Heading = { id: string; level: number; text: string };
export type FileRevision = { sha256: string; len: number; file_id: string };
export type Doc = {
  path: DocId;
  title: string;
  html: string;
  headings: Heading[];
  mtime: number;
  revision: FileRevision;
  openedAt: string;
  dirty: boolean;
  removed?: boolean;
};
export type RecentEntry = { path: string; title: string; viewedAt: string };
export type UiState = {
  sidebarVisible: boolean;
  tocVisible: boolean;
  themeOverride: 'light' | 'dark' | null;
  paletteOpen: boolean;
  findOpen: boolean;
};

const MAX_OPEN_DOCS = 10;
const MAX_RECENTLY_VIEWED = 20;
const MIN_OPEN_AGE_MS = 5 * 24 * 60 * 60 * 1000;

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
    recentlyViewed: [
      ...moved.map(doc => ({ path: doc.path, title: doc.title, viewedAt })),
      ...recentlyViewed.filter(entry => !movedPaths.has(entry.path)),
    ].slice(0, MAX_RECENTLY_VIEWED),
    movedPaths,
  };
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
  openFile: (path: string, options?: { pushHistory?: boolean; activate?: boolean; prepend?: boolean; openedAt?: string; prune?: boolean }) => Promise<void>;
  openMany: (paths: string[]) => Promise<void>;
  activate: (id: DocId, options?: { pushHistory?: boolean; updateOpenedAt?: boolean }) => void;
  close: (id: DocId) => void;
  closeOthers: (id: DocId) => void;
  reopenViewed: (path: string) => Promise<void>;
  pruneOpenDocuments: () => void;
  removeViewed: (path: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;
  markDirty: (path: string, mtime: number) => Promise<void>;
  markRemoved: (path: string) => void;
  handleDetachedClosed: (path: string) => void;
  refreshActive: () => Promise<void>;
  setTaskChecked: (path: string, taskLine: number, taskColumn: number, expectedRevision: FileRevision, checked: boolean) => Promise<boolean>;
  setSidebar: (visible: boolean) => void;
  setToc: (visible: boolean) => void;
  setThemeOverride: (t: 'light' | 'dark' | null) => void;
  toggleTheme: () => void;
  setPalette: (open: boolean) => void;
  setFind: (open: boolean) => void;
  clearError: () => void;
  setInfoToast: (msg: string | null) => void;
  hydrateFromDisk: () => Promise<Record<string, number>>;
};

export type RenderedDoc = { html: string; title: string; path: string; headings: Heading[]; mtime: number; revision: FileRevision; local_images: string[] };
type TaskEditResult = { status: 'updated' | 'conflict'; document: RenderedDoc; reason?: string };
function sameRevision(a: FileRevision, b: FileRevision): boolean {
  return a.sha256 === b.sha256 && a.len === b.len && a.file_id === b.file_id;
}

export const useStore = create<StoreState>()((set, get) => ({
  openDocs: [],
  activeDocId: null,
  recentlyViewed: [],
  lastError: null,
  infoToast: null,
  ui: { sidebarVisible: true, tocVisible: true, themeOverride: null, paletteOpen: false, findOpen: false },
  navBack: [],
  navForward: [],

  openFile: async (path, options) => {
    const pushHistory = options?.pushHistory ?? true;
    const doActivate = options?.activate ?? true;
    const { openDocs, activate } = get();
    // Always strip from viewed history when (re)opening — regardless of whether it's already open.
    set(s => ({ recentlyViewed: s.recentlyViewed.filter(r => r.path !== path) }));
    if (openDocs.find(d => d.path === path)) { if (doActivate) activate(path, { pushHistory }); return; }
    const r = await invoke<RenderedDoc>('render_markdown', { path });
    const doc = {
      path,
      title: r.title,
      html: r.html,
      headings: r.headings,
      mtime: r.mtime,
      revision: r.revision,
      openedAt: options?.openedAt ?? new Date().toISOString(),
      dirty: false,
      removed: false,
    };
    set(s => ({ openDocs: options?.prepend === false ? [...s.openDocs, doc] : [doc, ...s.openDocs] }));
    if (options?.prune !== false) get().pruneOpenDocuments();
    await invoke('watch_paths', { paths: [path] }).catch((err: unknown) => set({ lastError: `Watch failed: ${err}` }));
    if (r.local_images.length > 0) invoke('watch_images', { md: path, images: r.local_images }).catch(() => {});
    if (doActivate) activate(path, { pushHistory });
  },

  pruneOpenDocuments: () => {
    const { openDocs, activeDocId, recentlyViewed } = get();
    const pruned = pruneOpenDocs(openDocs, activeDocId, recentlyViewed, Date.now());
    if (!pruned) return;
    set({ openDocs: pruned.openDocs, recentlyViewed: pruned.recentlyViewed });
    for (const movedPath of pruned.movedPaths) {
      invoke('unwatch', { path: movedPath }).catch(() => {});
      invoke('unwatch_images', { md: movedPath }).catch(() => {});
    }
  },

  openMany: async (paths) => {
    if (paths.length === 0) return;
    const errors: string[] = [];
    for (const p of paths) {
      try {
        await get().openFile(p);
      } catch (err) {
        errors.push(`${p.split('/').pop() ?? p}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length > 0) set({ lastError: errors.join('\n') });
    const { activeDocId } = get();
    const opened = paths.filter(p => get().openDocs.find(d => d.path === p));
    if (opened.length > 0 && !opened.includes(activeDocId ?? '')) get().activate(opened[0]);
  },

  activate: (id, opts) => {
    const { activeDocId, navBack, openDocs } = get();
    const pushHistory = opts?.pushHistory !== false;
    const updateOpenedAt = opts?.updateOpenedAt !== false && activeDocId !== id;
    const navigatedAt = updateOpenedAt ? new Date().toISOString() : undefined;
    const wasDirty = openDocs.find(d => d.path === id)?.dirty === true;
    set(s => ({
      activeDocId: id,
      openDocs: s.openDocs.map(d => d.path === id
        ? { ...d, ...(navigatedAt ? { openedAt: navigatedAt } : {}), dirty: false }
        : d),
      navBack: pushHistory && activeDocId && activeDocId !== id ? [...navBack, activeDocId] : s.navBack,
      navForward: pushHistory ? [] : s.navForward,
    }));
    // The doc changed on disk while it was in the background (markDirty only
    // flags it in that case, it doesn't re-render) — its `html` is stale
    // until refreshed now that it's the active doc.
    if (wasDirty) {
      void get().refreshActive().catch((err: unknown) => set({ lastError: `Refresh failed: ${err}` }));
    }
  },

  close: (id) => {
    const { openDocs, activeDocId, recentlyViewed } = get();
    const doc = openDocs.find(d => d.path === id);
    if (!doc) return;
    const newRecents = [{ path: doc.path, title: doc.title, viewedAt: new Date().toISOString() }, ...recentlyViewed].slice(0, MAX_RECENTLY_VIEWED);
    const newDocs = openDocs.filter(d => d.path !== id);
    let newActive: DocId | null = activeDocId;
    if (activeDocId === id) {
      const idx = openDocs.findIndex(d => d.path === id);
      newActive = newDocs[idx]?.path ?? newDocs[idx - 1]?.path ?? null;
    }
    invoke('unwatch', { path: id }).catch(() => {});
    invoke('unwatch_images', { md: id }).catch(() => {});
    set(s => ({
      openDocs: newDocs,
      activeDocId: newActive,
      recentlyViewed: newRecents,
      navBack: s.navBack.filter(p => p !== id),
      navForward: s.navForward.filter(p => p !== id),
    }));
  },

  closeOthers: (id) => {
    const { openDocs, close } = get();
    openDocs.filter(d => d.path !== id).forEach(d => close(d.path));
  },

  reopenViewed: async (path) => {
    set(s => ({ recentlyViewed: s.recentlyViewed.filter(r => r.path !== path) }));
    await get().openFile(path);
  },

  removeViewed: (path) => {
    set(s => ({ recentlyViewed: s.recentlyViewed.filter(r => r.path !== path) }));
  },

  navigateBack: () => {
    const { navBack, activeDocId, navForward } = get();
    if (navBack.length === 0) return;
    const prev = navBack[navBack.length - 1];
    set({ navBack: navBack.slice(0, -1), navForward: activeDocId ? [activeDocId, ...navForward] : navForward });
    get().activate(prev, { pushHistory: false });
  },

  navigateForward: () => {
    const { navForward, activeDocId, navBack } = get();
    if (navForward.length === 0) return;
    const next = navForward[0];
    set({ navForward: navForward.slice(1), navBack: activeDocId ? [...navBack, activeDocId] : navBack });
    get().activate(next, { pushHistory: false });
  },

  markDirty: async (path, mtime) => {
    const { activeDocId } = get();
    if (path === activeDocId) {
      try {
        const r = await invoke<RenderedDoc>('render_markdown', { path });
        invoke('watch_images', { md: path, images: r.local_images }).catch(() => {});
        set(s => ({ openDocs: s.openDocs.map(d => d.path === path ? { ...d, html: r.html, headings: r.headings, mtime: r.mtime, revision: r.revision, dirty: false, removed: false } : d) }));
      } catch { /* keep old */ }
    } else {
      set(s => ({ openDocs: s.openDocs.map(d => d.path === path ? { ...d, dirty: true, mtime } : d) }));
    }
  },

  markRemoved: (path) => {
    set(s => ({ openDocs: s.openDocs.map(d => d.path === path ? { ...d, removed: true } : d) }));
  },

  // A detached (`doc-<uuid>`) window closed. That window held its own
  // reference on the shared file watcher (from its own `watch_paths` call
  // when it opened `path`), which nothing else releases when its native
  // close button is used — so drop it here. If the doc isn't open in this
  // window either, it also belongs in Recently Viewed.
  handleDetachedClosed: (path) => {
    invoke('unwatch', { path }).catch(() => {});
    const { openDocs, recentlyViewed } = get();
    if (openDocs.some(d => d.path === path)) return;
    if (recentlyViewed.some(r => r.path === path)) return;
    const entry = { path, title: stemName(path), viewedAt: new Date().toISOString() };
    set(s => ({ recentlyViewed: [entry, ...s.recentlyViewed].slice(0, MAX_RECENTLY_VIEWED) }));
  },

  refreshActive: async () => {
    const { activeDocId } = get();
    if (!activeDocId) return;
    const r = await invoke<RenderedDoc>('render_markdown', { path: activeDocId });
    invoke('watch_images', { md: activeDocId, images: r.local_images }).catch(() => {});
    set(s => ({ openDocs: s.openDocs.map(d => d.path === activeDocId ? { ...d, html: r.html, headings: r.headings, mtime: r.mtime, revision: r.revision, dirty: false, removed: false } : d) }));
  },
  setTaskChecked: async (path, taskLine, taskColumn, expectedRevision, checked) => {
    const mergeDocument = (document: RenderedDoc, guardRevision = expectedRevision): boolean => {
      let committed = false;
      set(s => {
        const current = s.openDocs.find(d => d.path === path);
        if (!current || (!sameRevision(current.revision, guardRevision) && !sameRevision(current.revision, document.revision))) {
          return s;
        }
        committed = true;
        return {
          openDocs: s.openDocs.map(d => d.path === path
            ? { ...d, html: document.html, title: document.title, headings: document.headings, mtime: document.mtime, revision: document.revision, dirty: false, removed: false }
            : d),
        };
      });
      if (committed) invoke('watch_images', { md: path, images: document.local_images }).catch(() => {});
      return committed;
    };

    try {
      const result = await invoke<TaskEditResult>('set_task_checked', {
        path,
        taskLine,
        taskColumn,
        expectedRevision,
        checked,
      });
      mergeDocument(result.document);
      if (result.status === 'conflict') {
        set({ lastError: 'The file changed during the checkbox update. Reloaded the latest content without retrying.' });
        return false;
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const beforeReadRevision = get().openDocs.find(d => d.path === path)?.revision;
      try {
        const document = await invoke<RenderedDoc>('render_markdown', { path });
        if (beforeReadRevision) mergeDocument(document);
      } catch {
        // Keep the last known render; the watcher or an explicit refresh can reconcile it.
      }
      set({ lastError: `Checkbox update could not be confirmed: ${message}` });
      return false;
    }
  },

  setSidebar: (visible) => set(s => ({ ui: { ...s.ui, sidebarVisible: visible } })),
  setToc: (visible) => set(s => ({ ui: { ...s.ui, tocVisible: visible } })),
  setThemeOverride: (t) => set(s => ({ ui: { ...s.ui, themeOverride: t } })),
  toggleTheme: () => set(s => ({ ui: { ...s.ui, themeOverride: flipTheme(s.ui.themeOverride) } })),
  setPalette: (open) => set(s => ({ ui: { ...s.ui, paletteOpen: open } })),
  setFind: (open) => set(s => ({ ui: { ...s.ui, findOpen: open } })),

  clearError: () => set({ lastError: null }),
  setInfoToast: (msg) => set({ infoToast: msg }),

  hydrateFromDisk: async () => {
    const persisted = await loadState();
    if (!persisted) return {};
    set(s => ({ ui: { ...s.ui, ...persisted.ui, paletteOpen: false, findOpen: false }, recentlyViewed: persisted.recentlyViewed }));
    const validPaths: string[] = [];
    for (const p of persisted.openDocs) {
      try {
        // Restoring docs is not user navigation and must not seed history or
        // refresh their persisted openedAt timestamps.
        await get().openFile(p, { pushHistory: false, activate: false, prepend: false, openedAt: persisted.openedAt[p] ?? new Date().toISOString(), prune: false });
        validPaths.push(p);
      } catch { /* missing file — skip silently */ }
    }
    // Restore the persisted active doc ONLY if no explicit open already claimed
    // focus this launch. An explicitly opened file must always win.
    if (get().activeDocId === null && persisted.activeDoc && validPaths.includes(persisted.activeDoc)) {
      get().activate(persisted.activeDoc, { pushHistory: false, updateOpenedAt: false });
    }
    get().pruneOpenDocuments();
    // Defensive reset: guarantees a clean history regardless of the path above.
    set({ navBack: [], navForward: [] });
    if (persisted.openDocs.length > validPaths.length) {
      set({ infoToast: `${persisted.openDocs.length - validPaths.length} file(s) missing from last session` });
    }
    return persisted.scrollPositions;
  },
}));
