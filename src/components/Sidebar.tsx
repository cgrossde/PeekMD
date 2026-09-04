import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { useStore } from '../store';
import { SidebarRow } from './SidebarRow';
import { timeAgo } from '../lib/timeAgo';
import { stemName, parentFolder } from '../lib/paths';
import { FileText, Clock } from 'lucide-react';

export function Sidebar({ onResizeHandleMouseDown }: { onResizeHandleMouseDown: (e: React.MouseEvent) => void }) {
  const openDocs = useStore(s => s.openDocs);
  const activeDocId = useStore(s => s.activeDocId);
  const recentlyViewed = useStore(s => s.recentlyViewed);
  const activate = useStore(s => s.activate);
  const close = useStore(s => s.close);
  const reopenViewed = useStore(s => s.reopenViewed);
  const removeViewed = useStore(s => s.removeViewed);
  const closeOthers = useStore(s => s.closeOthers);

  // Listen for context menu selections
  useEffect(() => {
    const promise = listen<{ action: string; path: string }>('sidebar-menu-click', (e) => {
      const { action, path } = e.payload;
      const st = useStore.getState();
      switch (action) {
        case 'reveal':
          void invoke('reveal_in_finder', { path });
          break;
        case 'copy_path':
          void invoke('copy_path', { path });
          break;
        case 'copy_html': {
          const doc = st.openDocs.find(d => d.path === path);
          if (doc) void invoke('copy_html', { html: doc.html });
          break;
        }
        case 'close':
          close(path);
          break;
        case 'close_others':
          closeOthers(path);
          break;
      }
    });
    return () => { void promise.then(u => u()); };
  }, [close, closeOthers]);

  const handleContext = (path: string) => (e: MouseEvent) => {
    void invoke('show_sidebar_context_menu', { path, x: e.clientX, y: e.clientY });
  };

  return (
    <aside className="peekmd-sidebar" aria-label="Documents">
      <div className="peekmd-sidebar-resize-handle" onMouseDown={onResizeHandleMouseDown} aria-hidden />
      <section className="peekmd-sidebar-section">
        <div className="peekmd-sidebar-header">Open Documents</div>
        {openDocs.length === 0 && (
          <div className="peekmd-sidebar-empty">No open documents</div>
        )}
        <ul className="peekmd-sidebar-list" role="listbox" aria-label="Open documents">
          {openDocs.map(doc => (
            <SidebarRow
              key={doc.path}
              doc={doc}
              active={doc.path === activeDocId}
              folder={parentFolder(doc.path)}
              onActivate={() => activate(doc.path)}
              onClose={() => close(doc.path)}
              onContext={handleContext(doc.path)}
            />
          ))}
        </ul>
      </section>

      {recentlyViewed.length > 0 && (
        <section className="peekmd-sidebar-section">
          <div className="peekmd-sidebar-header">
            <Clock size={12} strokeWidth={2} style={{ marginRight: 4 }} />
            Recently Viewed
          </div>
          <ul className="peekmd-sidebar-list">
            {recentlyViewed.map(entry => {
              const folder = parentFolder(entry.path);
              return (
                <li key={entry.path} className="peekmd-sidebar-recent-row">
                  <button
                    type="button"
                    className="peekmd-sidebar-recent-btn"
                    onClick={() => void reopenViewed(entry.path)}
                    title={entry.path}
                  >
                    <FileText size={12} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                    <span className="peekmd-sidebar-recent-content">
                      <span className="peekmd-sidebar-recent-title">{entry.title || stemName(entry.path)}</span>
                      <span className="peekmd-sidebar-recent-meta">
                        {folder && <span className="peekmd-sidebar-folder">{folder}</span>}
                        <span className="peekmd-sidebar-recent-time">{timeAgo(entry.viewedAt)}</span>
                      </span>
                    </span>
                  </button>
                  <button
                    className="peekmd-sidebar-recent-remove"
                    type="button"
                    aria-label={`Remove ${entry.title || stemName(entry.path)} from recently viewed`}
                    onClick={() => removeViewed(entry.path)}
                  >×</button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}
