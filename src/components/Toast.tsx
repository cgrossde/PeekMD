import { useEffect, useRef } from 'react';
import { useStore } from '../store';

function ToastItem({
  message,
  kind,
  onDismiss,
}: {
  message: string;
  kind: 'error' | 'info';
  onDismiss: () => void;
}) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, 4000) as unknown as number;
    return () => {
      clearTimeout(timerRef.current ?? undefined);
    };
  }, [message, onDismiss]);

  return (
    <div className={`peekmd-toast peekmd-toast-${kind}`} role="alert" aria-live="polite">
      <span className="peekmd-toast-msg">{message}</span>
      <button
        type="button"
        className="peekmd-toast-close"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >×</button>
    </div>
  );
}

export function Toast() {
  const lastError = useStore(s => s.lastError);
  const infoToast = useStore(s => s.infoToast);
  const clearError = useStore(s => s.clearError);
  const setInfoToast = useStore(s => s.setInfoToast);

  if (!lastError && !infoToast) return null;

  return (
    <div className="peekmd-toast-stack">
      {lastError && (
        <ToastItem message={lastError} kind="error" onDismiss={clearError} />
      )}
      {infoToast && (
        <ToastItem message={infoToast} kind="info" onDismiss={() => setInfoToast(null)} />
      )}
    </div>
  );
}
