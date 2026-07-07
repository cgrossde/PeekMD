import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Doc } from '../store';

type Props = {
  doc: Doc;
  active: boolean;
  qualifier: string | null;
  onActivate: () => void;
  onClose: () => void;
  onContext: (e: MouseEvent) => void;
};

export function SidebarRow({ doc, active, qualifier, onActivate, onClose, onContext }: Props) {
  const handleDragStart = useCallback((e: React.DragEvent<HTMLLIElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-peekmd-doc', doc.path);
  }, [doc.path]);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLLIElement>) => {
    if (e.dataTransfer.dropEffect !== 'none') return;
    const outsideX = e.screenX < window.screenX || e.screenX > window.screenX + window.outerWidth;
    const outsideY = e.screenY < window.screenY || e.screenY > window.screenY + window.outerHeight;
    if (outsideX || outsideY) {
      void invoke('spawn_detached_window', {
        path: doc.path,
        screenX: e.screenX,
        screenY: e.screenY,
      });
    }
  }, [doc.path]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLLIElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  }, [onActivate]);

  return (
    <li
      className={`peekmd-sidebar-row${active ? ' is-active' : ''}${doc.removed ? ' is-removed' : ''}`}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => { e.preventDefault(); onContext(e.nativeEvent); }}
      role="option"
      aria-selected={active}
      tabIndex={0}
      draggable={!doc.removed}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <span className="peekmd-sidebar-row-title">
        {doc.title}
        {qualifier && <span className="peekmd-sidebar-qualifier"> {qualifier}</span>}
        {doc.dirty && <span className="peekmd-dirty-dot" aria-label="modified"> •</span>}
        {doc.removed && <span className="peekmd-removed-badge" aria-label="deleted"> ✕</span>}
      </span>
      <button
        className="peekmd-sidebar-close"
        type="button"
        aria-label={`Close ${doc.title}`}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >×</button>
    </li>
  );
}
