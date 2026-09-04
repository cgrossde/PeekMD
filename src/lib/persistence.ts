import { LazyStore } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';

const STORE_FILE = 'state.json';
const CURRENT_VERSION = 2;

export type PersistedUi = {
  sidebarVisible: boolean;
  tocVisible: boolean;
  themeOverride: 'light' | 'dark' | null;
};

export type PersistedRecentEntry = {
  path: string;
  title: string;
  viewedAt: string;
};

type StoredRecentEntry = {
  path: string;
  title: string;
  viewedAt?: string;
  closedAt?: string;
};

export type Persisted = {
  version: number;
  openDocs: string[];
  openedAt: Record<string, string>;
  activeDoc: string | null;
  rightPaneDoc: null;
  recentlyViewed: PersistedRecentEntry[];
  scrollPositions: Record<string, number>;
  ui: PersistedUi;
};
const store = new LazyStore(STORE_FILE);
let saveTimer: number | null = null;

export async function loadState(): Promise<Persisted | null> {
  const v = await store.get<number>('version');
  if (v !== null && v !== CURRENT_VERSION) {
    // Version mismatch: back up old state.json, then boot with defaults.
    try { await invoke('backup_state_file'); } catch { /* ignore */ }
  }
  if (v !== CURRENT_VERSION) return null;
  const openDocs = (await store.get<string[]>('openDocs')) ?? [];
  const openedAt = (await store.get<Record<string, string>>('openedAt')) ?? {};
  const activeDoc = (await store.get<string | null>('activeDoc')) ?? null;
  const storedViewed = await store.get<StoredRecentEntry[]>('recentlyViewed');
  const legacyClosed = await store.get<StoredRecentEntry[]>('recentlyClosed');
  const recentlyViewed = (storedViewed ?? legacyClosed ?? []).map(entry => ({
    path: entry.path,
    title: entry.title,
    viewedAt: entry.viewedAt ?? entry.closedAt ?? new Date().toISOString(),
  }));
  const scrollPositions = (await store.get<Record<string, number>>('scrollPositions')) ?? {};
  const ui = (await store.get<PersistedUi>('ui')) ?? {
    sidebarVisible: true, tocVisible: true, themeOverride: null,
  };
  return { version: CURRENT_VERSION, openDocs, openedAt, activeDoc, rightPaneDoc: null, recentlyViewed, scrollPositions, ui };
}

export function scheduleSave(getState: () => Persisted): void {
  clearTimeout(saveTimer ?? undefined);
  saveTimer = setTimeout(async () => {
    const s = getState();
    await store.set('version', s.version);
    await store.set('openDocs', s.openDocs);
    await store.set('openedAt', s.openedAt);
    await store.set('activeDoc', s.activeDoc);
    await store.set('rightPaneDoc', null);
    await store.set('recentlyViewed', s.recentlyViewed);
    await store.set('scrollPositions', s.scrollPositions);
    await store.set('ui', s.ui);
    await store.save();
  }, 500) as unknown as number;
}
