import { useEffect, useRef } from 'react';
import { useStore } from '../store';

type ShortcutGroup = {
  title: string;
  items: Array<{ action: string; keys: string[] }>;
};

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    items: [
      { action: 'Open file', keys: ['⌘', 'O'] },
      { action: 'Close active document', keys: ['⌘', 'W'] },
      { action: 'Toggle edit / preview', keys: ['⌘', 'Enter'] },
      { action: 'Force re-render', keys: ['⌘', 'R'] },
      { action: 'Print / Save as PDF', keys: ['⌘', 'P'] },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { action: 'Toggle sidebar', keys: ['⌘', '\\'] },
      { action: 'Navigate back', keys: ['⌘', '←'] },
      { action: 'Navigate forward', keys: ['⌘', '→'] },
      { action: 'Activate document 1–9', keys: ['⌘', '1–9'] },
    ],
  },
  {
    title: 'Tools',
    items: [
      { action: 'Toggle command palette', keys: ['⌘', 'K'] },
      { action: 'Find in document', keys: ['⌘', 'F'] },
      { action: 'Toggle table of contents', keys: ['⌘', '⇧', 'T'] },
      { action: 'Toggle theme', keys: ['⌘', '⇧', 'D'] },
    ],
  },
  {
    title: 'Command Palette',
    items: [
      { action: 'Move selection down', keys: ['↓'] },
      { action: 'Move selection up', keys: ['↑'] },
      { action: 'Run selected result', keys: ['Enter'] },
      { action: 'Close', keys: ['Esc'] },
    ],
  },
  {
    title: 'Find',
    items: [
      { action: 'Next match', keys: ['Enter'] },
      { action: 'Previous match', keys: ['⇧', 'Enter'] },
      { action: 'Close', keys: ['Esc'] },
    ],
  },
];

export function ShortcutsModal() {
  const shortcutsOpen = useStore(s => s.ui.shortcutsOpen);
  const setShortcuts = useStore(s => s.setShortcuts);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!shortcutsOpen) return;

    const active = document.activeElement;
    previousFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShortcuts(false);
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const previous = previousFocusRef.current;
      const trigger = document.querySelector<HTMLElement>('[aria-controls="peekmd-shortcuts-dialog"]');
      if (previous?.isConnected) previous.focus();
      else if (trigger?.isConnected) trigger.focus();
      previousFocusRef.current = null;
    };
  }, [shortcutsOpen, setShortcuts]);

  if (!shortcutsOpen) return null;

  return (
    <div className="peekmd-shortcuts-backdrop" onClick={() => setShortcuts(false)}>
      <section
        className="peekmd-shortcuts-modal"
        id="peekmd-shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="peekmd-shortcuts-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="peekmd-shortcuts-header">
          <h1 id="peekmd-shortcuts-title">Keyboard shortcuts</h1>
          <button
            ref={closeButtonRef}
            type="button"
            className="peekmd-shortcuts-close"
            aria-label="Close keyboard shortcuts"
            onClick={() => setShortcuts(false)}
          >
            ×
          </button>
        </header>
        <div className="peekmd-shortcuts-body">
          <div className="peekmd-shortcuts-grid">
            {SHORTCUT_GROUPS.map(group => (
              <section className="peekmd-shortcuts-group" key={group.title}>
                <h2 className="peekmd-shortcuts-group-title">{group.title}</h2>
                <dl>
                  {group.items.map(item => (
                    <div className="peekmd-shortcuts-row" key={item.action}>
                      <dt className="peekmd-shortcuts-action">{item.action}</dt>
                      <dd className="peekmd-shortcuts-keys">
                        {item.keys.map((key, index) => <kbd className="peekmd-shortcuts-key" key={`${key}-${index}`}>{key}</kbd>)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
