import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useStore } from '../store';

export type MarkdownNavigation = 'fragment' | 'internal' | 'external';

export async function navigateMarkdownHref(basePath: string, href: string): Promise<MarkdownNavigation> {
  if (href.startsWith('#')) return 'fragment';
  const resolved = await invoke<string | null>('resolve_md_link', { base: basePath, href });
  if (resolved) {
    await useStore.getState().openFile(resolved);
    return 'internal';
  }
  await openUrl(href);
  return 'external';
}

export function installMdLinkHandler(): () => void {
  const handler = async (e: MouseEvent) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const a = target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (!href || href.startsWith('#')) return;
    e.preventDefault();
    const active = useStore.getState().openDocs.find(d => d.path === useStore.getState().activeDocId);
    if (!active) return;
    await navigateMarkdownHref(active.path, href);
  };
  document.addEventListener('click', handler, true);
  return () => document.removeEventListener('click', handler, true);
}
