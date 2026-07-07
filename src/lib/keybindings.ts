import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';

export function installGlobalKeybindings(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!e.metaKey) return;
    const k = e.key.toLowerCase();
    const st = useStore.getState();

    // While the Command Palette or Find bar owns keyboard input, don't let
    // background shortcuts fire underneath it — ⌘W previously closed the
    // active document while the palette was open, which reads as data loss.
    // Both overlays bind their own ⌘K/⌘F/Escape/arrow handling directly on
    // their input element, so this early return doesn't affect them.
    if (st.ui.paletteOpen || st.ui.findOpen) return;

    // ⌘O — open file
    if (k === 'o' && !e.shiftKey) {
      e.preventDefault();
      void openDialog({
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }],
        multiple: true,
      }).then(picked => {
        if (!picked) return;
        const paths = Array.isArray(picked) ? picked : [picked];
        if (paths.length > 0) void st.openMany(paths);
      });
      return;
    }

    // ⌘W — close active
    if (k === 'w' && !e.shiftKey) {
      e.preventDefault();
      if (st.activeDocId) st.close(st.activeDocId);
      return;
    }

    // ⌘R — force re-render
    if (k === 'r' && !e.shiftKey) {
      e.preventDefault();
      void st.refreshActive();
      return;
    }

    // ⌘\ — toggle sidebar
    if (e.key === '\\') {
      e.preventDefault();
      st.setSidebar(!st.ui.sidebarVisible);
      return;
    }

    // ⌘⇧D — toggle theme
    if (k === 'd' && e.shiftKey) {
      e.preventDefault();
      st.toggleTheme();
      return;
    }

    // ⌘← — navigate back
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      st.navigateBack();
      return;
    }

    // ⌘→ — navigate forward
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      st.navigateForward();
      return;
    }

    // ⌘1..9 — activate Nth doc
    const n = parseInt(e.key, 10);
    if (!isNaN(n) && n >= 1 && n <= 9 && !e.shiftKey) {
      e.preventDefault();
      const doc = st.openDocs[n - 1];
      if (doc) st.activate(doc.path);
      return;
    }

    // ⌘P — print (handler only, not swallowing ⌘K/⌘F/⌘⇧T — those are set by their components)
    if (k === 'p' && !e.shiftKey) {
      e.preventDefault();
      window.print();
      return;
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
