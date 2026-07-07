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
  closedAt: string;
};

export type Persisted = {
  version: number;
  openDocs: string[];
  activeDoc: string | null;
  rightPaneDoc: null;
  recentlyClosed: PersistedRecentEntry[];
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
  const activeDoc = (await store.get<string | null>('activeDoc')) ?? null;
  const recentlyClosed = (await store.get<PersistedRecentEntry[]>('recentlyClosed')) ?? [];
  const scrollPositions = (await store.get<Record<string, number>>('scrollPositions')) ?? {};
  const ui = (await store.get<PersistedUi>('ui')) ?? {
    sidebarVisible: true, tocVisible: true, themeOverride: null,
  };
  return { version: CURRENT_VERSION, openDocs, activeDoc, rightPaneDoc: null, recentlyClosed, scrollPositions, ui };
}

export function scheduleSave(getState: () => Persisted): void {
  clearTimeout(saveTimer ?? undefined);
  saveTimer = setTimeout(async () => {
    const s = getState();
    await store.set('version', s.version);
    await store.set('openDocs', s.openDocs);
    await store.set('activeDoc', s.activeDoc);
    await store.set('rightPaneDoc', null);
    await store.set('recentlyClosed', s.recentlyClosed);
    await store.set('scrollPositions', s.scrollPositions);
    await store.set('ui', s.ui);
    await store.save();
  }, 500) as unknown as number;
}
