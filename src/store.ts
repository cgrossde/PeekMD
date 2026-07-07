import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { loadState } from './lib/persistence';
import { flipTheme } from './lib/theme';
import { stemName } from './lib/paths';

export type DocId = string;
export type Heading = { id: string; level: number; text: string };
export type Doc = {
  path: DocId;
  title: string;
  html: string;
  headings: Heading[];
  mtime: number;
  dirty: boolean;
  removed?: boolean;
};
export type RecentEntry = { path: string; title: string; closedAt: string };
export type UiState = {
  sidebarVisible: boolean;
  tocVisible: boolean;
  themeOverride: 'light' | 'dark' | null;
  paletteOpen: boolean;
  findOpen: boolean;
};
export type StoreState = {
  openDocs: Doc[];
  activeDocId: DocId | null;
  recentlyClosed: RecentEntry[];
  lastError: string | null;
  infoToast: string | null;
  ui: UiState;
  navBack: DocId[];
  navForward: DocId[];
  openFile: (path: string, options?: { pushHistory?: boolean }) => Promise<void>;
  openMany: (paths: string[]) => Promise<void>;
  activate: (id: DocId, options?: { pushHistory?: boolean }) => void;
  close: (id: DocId) => void;
  closeOthers: (id: DocId) => void;
  reopenRecent: (path: string) => Promise<void>;
  navigateBack: () => void;
  navigateForward: () => void;
  markDirty: (path: string, mtime: number) => Promise<void>;
  markRemoved: (path: string) => void;
  handleDetachedClosed: (path: string) => void;
  refreshActive: () => Promise<void>;
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

type RenderedDoc = { html: string; title: string; path: string; headings: Heading[]; mtime: number; local_images: string[] };

export const useStore = create<StoreState>()((set, get) => ({
  openDocs: [],
  activeDocId: null,
  recentlyClosed: [],
  lastError: null,
  infoToast: null,
  ui: { sidebarVisible: true, tocVisible: true, themeOverride: null, paletteOpen: false, findOpen: false },
  navBack: [],
  navForward: [],

  openFile: async (path, options) => {
    const pushHistory = options?.pushHistory ?? true;
    const { openDocs, activate } = get();
    // Always strip from recents when (re)opening — regardless of whether it's already open.
    set(s => ({ recentlyClosed: s.recentlyClosed.filter(r => r.path !== path) }));
    if (openDocs.find(d => d.path === path)) { activate(path, { pushHistory }); return; }
    const r = await invoke<RenderedDoc>('render_markdown', { path });
    set(s => ({ openDocs: [...s.openDocs, { path, title: r.title, html: r.html, headings: r.headings, mtime: r.mtime, dirty: false }] }));
    await invoke('watch_paths', { paths: [path] }).catch((err: unknown) => set({ lastError: `Watch failed: ${err}` }));
    if (r.local_images.length > 0) invoke('watch_images', { md: path, images: r.local_images }).catch(() => {});
    activate(path, { pushHistory });
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
    const wasDirty = openDocs.find(d => d.path === id)?.dirty === true;
    set(s => ({
      activeDocId: id,
      openDocs: s.openDocs.map(d => d.path === id ? { ...d, dirty: false } : d),
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
    const { openDocs, activeDocId, recentlyClosed } = get();
    const doc = openDocs.find(d => d.path === id);
    if (!doc) return;
    const newRecents = [{ path: doc.path, title: doc.title, closedAt: new Date().toISOString() }, ...recentlyClosed].slice(0, 20);
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
      recentlyClosed: newRecents,
      navBack: s.navBack.filter(p => p !== id),
      navForward: s.navForward.filter(p => p !== id),
    }));
  },

  closeOthers: (id) => {
    const { openDocs, close } = get();
    openDocs.filter(d => d.path !== id).forEach(d => close(d.path));
  },

  reopenRecent: async (path) => {
    set(s => ({ recentlyClosed: s.recentlyClosed.filter(r => r.path !== path) }));
    await get().openFile(path);
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
        set(s => ({ openDocs: s.openDocs.map(d => d.path === path ? { ...d, html: r.html, headings: r.headings, mtime: r.mtime, dirty: false } : d) }));
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
  // window either, it also belongs in Recently Closed per the SPEC ("Closing
  // a detached window returns the doc to the parent window's Recently Closed
  // if it wasn't open there").
  handleDetachedClosed: (path) => {
    invoke('unwatch', { path }).catch(() => {});
    const { openDocs, recentlyClosed } = get();
    if (openDocs.some(d => d.path === path)) return;
    if (recentlyClosed.some(r => r.path === path)) return;
    const entry = { path, title: stemName(path), closedAt: new Date().toISOString() };
    set(s => ({ recentlyClosed: [entry, ...s.recentlyClosed].slice(0, 20) }));
  },

  refreshActive: async () => {
    const { activeDocId } = get();
    if (!activeDocId) return;
    const r = await invoke<RenderedDoc>('render_markdown', { path: activeDocId });
    invoke('watch_images', { md: activeDocId, images: r.local_images }).catch(() => {});
    set(s => ({ openDocs: s.openDocs.map(d => d.path === activeDocId ? { ...d, html: r.html, headings: r.headings, mtime: r.mtime } : d) }));
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
    set(s => ({ ui: { ...s.ui, ...persisted.ui, paletteOpen: false, findOpen: false }, recentlyClosed: persisted.recentlyClosed }));
    const validPaths: string[] = [];
    for (const p of persisted.openDocs) {
      try {
        // pushHistory: false — restoring docs is not user navigation and must
        // not seed navBack/navForward (history starts clean every session).
        await get().openFile(p, { pushHistory: false });
        validPaths.push(p);
      } catch { /* missing file — skip silently */ }
    }
    if (persisted.activeDoc && validPaths.includes(persisted.activeDoc)) {
      get().activate(persisted.activeDoc, { pushHistory: false });
    }
    // Defensive reset: guarantees a clean history regardless of the path above.
    set({ navBack: [], navForward: [] });
    if (persisted.openDocs.length > validPaths.length) {
      set({ infoToast: `${persisted.openDocs.length - validPaths.length} file(s) missing from last session` });
    }
    return persisted.scrollPositions;
  },
}));
