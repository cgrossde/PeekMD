import { ChevronLeft, ChevronRight, PanelLeft } from 'lucide-react';
import { useStore } from '../store';
import { TocChip } from './TOC';
import { formatHome } from '../lib/paths';

export function TopBar() {
  const activeDoc = useStore(s => s.openDocs.find(d => d.path === s.activeDocId));
  const navBack = useStore(s => s.navBack);
  const navForward = useStore(s => s.navForward);
  const sidebarVisible = useStore(s => s.ui.sidebarVisible);
  const navigateBack = useStore(s => s.navigateBack);
  const navigateForward = useStore(s => s.navigateForward);
  const setSidebar = useStore(s => s.setSidebar);
  const toggleTheme = useStore(s => s.toggleTheme);
  const shortcutsOpen = useStore(s => s.ui.shortcutsOpen);
  const setShortcuts = useStore(s => s.setShortcuts);

  const hasNav = navBack.length + navForward.length > 0;

  return (
    <header className="peekmd-topbar">
      <div className="peekmd-topbar-left">
        <button
          type="button"
          className="peekmd-topbar-icon-btn"
          onClick={() => setSidebar(!sidebarVisible)}
          aria-label="Toggle sidebar (⌘\\)"
          title="Toggle sidebar (⌘\\)"
        >
          <PanelLeft size={16} strokeWidth={1.75} />
        </button>
        {hasNav && (
          <>
            <button
              type="button"
              className="peekmd-topbar-icon-btn"
              onClick={() => { void navigateBack(); }}
              disabled={navBack.length === 0}
              aria-label="Navigate back (⌘←)"
              title="Back (⌘←)"
            >
              <ChevronLeft size={16} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="peekmd-topbar-icon-btn"
              disabled={navForward.length === 0}
              onClick={() => { void navigateForward(); }}
              title="Forward (⌘→)"
            >
              <ChevronRight size={16} strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>

      <div className="peekmd-topbar-center">
        {activeDoc && (
          <span className="peekmd-topbar-title" title={activeDoc.path}>
            {activeDoc.title}
            <span className="peekmd-topbar-path"> — {formatHome(activeDoc.path)}</span>
          </span>
        )}
      </div>

      <div className="peekmd-topbar-right">
        <TocChip />
        <button
          type="button"
          className="peekmd-topbar-icon-btn peekmd-theme-toggle"
          onClick={toggleTheme}
          aria-label="Toggle theme (⌘⇧D)"
          title="Toggle theme (⌘⇧D)"
        >
          ◑
        </button>
        <button
          type="button"
          className="peekmd-topbar-icon-btn peekmd-shortcuts-trigger"
          onClick={() => setShortcuts(true)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          aria-haspopup="dialog"
          aria-controls="peekmd-shortcuts-dialog"
          aria-expanded={shortcutsOpen}
        >
          ?
        </button>
      </div>
    </header>
  );
}
