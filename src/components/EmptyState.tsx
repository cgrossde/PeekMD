import { FileText, Clock } from 'lucide-react';
import { useStore } from '../store';
import { timeAgo } from '../lib/timeAgo';
import { formatHome, stemName } from '../lib/paths';

type Props = {
  onPickFile: () => void;
  isDragOver: boolean;
};

export function EmptyState({ onPickFile, isDragOver }: Props) {
  const recents = useStore(s => s.recentlyViewed);
  const reopenViewed = useStore(s => s.reopenViewed);

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
            <span>Recently Viewed</span>
          </div>
          <ul className="peekmd-recent-list">
            {recents.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className="peekmd-recent-item"
                  onClick={() => void reopenViewed(entry.path)}
                  title={entry.path}
                >
                  <FileText size={14} strokeWidth={1.5} className="peekmd-recent-icon" />
                  <span className="peekmd-recent-title">{entry.title || stemName(entry.path)}</span>
                  <span className="peekmd-recent-path">{formatHome(entry.path)}</span>
                  <span className="peekmd-recent-time">{timeAgo(entry.viewedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
