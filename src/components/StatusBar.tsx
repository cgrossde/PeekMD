import type { EditStatus } from '../store';

type StatusBarProps = {
  href: string | null;
  editStatus?: EditStatus;
};

const EDIT_LABELS: Record<EditStatus, string> = {
  clean: 'Saved',
  dirty: 'Editing',
  saving: 'Saving…',
  conflict: 'Conflict',
  error: 'Save failed',
};

export function StatusBar({ href, editStatus }: StatusBarProps) {
  return (
    <footer className={`peekmd-statusbar${href || editStatus ? ' is-active' : ''}`} role="status" aria-live="polite">
      {editStatus ? <span className="peekmd-statusbar-label">{EDIT_LABELS[editStatus]}</span> : href && <><span className="peekmd-statusbar-label">Link</span><span className="peekmd-statusbar-link" title={href}>{href}</span></>}
    </footer>
  );
}
