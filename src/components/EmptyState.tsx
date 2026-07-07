import { FileText, Clock } from 'lucide-react';
import { useStore } from '../store';
import { timeAgo } from '../lib/timeAgo';
import { formatHome, stemName } from '../lib/paths';

type Props = {
  onPickFile: () => void;
  isDragOver: boolean;
};

export function EmptyState({ onPickFile, isDragOver }: Props) {
  const recents = useStore(s => s.recentlyClosed);
  const reopenRecent = useStore(s => s.reopenRecent);

  return (
    <div className="peekmd-empty">
      <div className={`peekmd-empty-hero${isDragOver ? ' is-drag-over' : ''}`}>
        <div className="peekmd-empty-icon" aria-hidden>
          <FileText size={48} strokeWidth={1.25} />
        </div>
        <h1 className="peekmd-empty-title">PeekMD</h1>
        <p className="peekmd-empty-hint">
          Drop a Markdown file anywhere in this window
        </p>
        <button className="peekmd-empty-cta" type="button" onClick={onPickFile}>
          Open file <kbd className="peekmd-kbd"><span className="peekmd-kbd-mod">⌘</span>O</kbd>
        </button>
      </div>

      {recents.length > 0 && (
        <div className="peekmd-recent">
          <div className="peekmd-recent-header">
            <Clock size={12} strokeWidth={2} />
            <span>Recent</span>
          </div>
          <ul className="peekmd-recent-list">
            {recents.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  className="peekmd-recent-item"
                  onClick={() => void reopenRecent(f.path)}
                  title={f.path}
                >
                  <FileText size={14} strokeWidth={1.5} className="peekmd-recent-icon" />
                  <span className="peekmd-recent-title">{f.title || stemName(f.path)}</span>
                  <span className="peekmd-recent-path">{formatHome(f.path)}</span>
                  <span className="peekmd-recent-time">{timeAgo(f.closedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
