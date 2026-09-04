type StatusBarProps = {
  href: string | null;
};

export function StatusBar({ href }: StatusBarProps) {
  return (
    <footer className={`peekmd-statusbar${href ? ' is-active' : ''}`} role="status" aria-live="polite">
      {href && (
        <>
          <span className="peekmd-statusbar-label">Link</span>
          <span className="peekmd-statusbar-link" title={href}>{href}</span>
        </>
      )}
    </footer>
  );
}
