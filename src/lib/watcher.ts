import { listen } from '@tauri-apps/api/event';
import { useStore } from '../store';
import { scrollToChange } from './scrollToChange';

/**
 * initWatcher sets up the file-changed / file-removed listeners.
 *
 * getContainer is called lazily each time — it returns the live scroll
 * container from a React ref so we never capture a stale DOM node.
 *
 * Scroll-to-change is deferred with setTimeout(0) so it runs after React
 * has committed the new innerHTML to the DOM. useLayoutEffect was tried
 * but it fires synchronously during the same render that calls set() in
 * markDirty — before the async continuation that calls setPending — so
 * the pending was always null on the first edit.
 */
export function initWatcher(getContainer: () => HTMLElement | null) {
  const unlisteners: Array<() => void> = [];

  listen<{ path: string; mtime: number }>('file-changed', async (e) => {
    const path = e.payload.path;
    const before = useStore.getState();
    const doc = before.openDocs.find(d => d.path === path);
    if (!doc) return;
    const prevHtml = doc.html;
    await before.markDirty(path, e.payload.mtime);
    // Re-read after the async gap — activeDocId may have changed.
    const after = useStore.getState();
    if (after.activeDocId !== path) return;
    const nextHtml = after.openDocs.find(d => d.path === path)?.html;
    if (!nextHtml || nextHtml === prevHtml) return;
    // Defer until after React has committed the new HTML to the DOM.
    setTimeout(() => {
      const c = getContainer();
      if (c) scrollToChange(prevHtml, nextHtml, c);
    }, 0);
  }).then(u => unlisteners.push(u));

  listen<{ path: string }>('file-removed', (e) => {
    useStore.getState().markRemoved(e.payload.path);
  }).then(u => unlisteners.push(u));

  return () => unlisteners.forEach(u => u());
}
