import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useStore } from '../store';

export function installMdLinkHandler(): () => void {
  const handler = async (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (!href || href.startsWith('#')) return; // in-page anchor: leave alone
    e.preventDefault();
    const st = useStore.getState();
    const active = st.openDocs.find(d => d.path === st.activeDocId);
    if (!active) return;
    const resolved = await invoke<string | null>('resolve_md_link', { base: active.path, href });
    if (resolved) {
      await st.openFile(resolved);
    } else {
      await openUrl(href);
    }
  };
  document.addEventListener('click', handler, true);
  return () => document.removeEventListener('click', handler, true);
}
