/**
 * Theme management.
 *
 * The store's `ui.themeOverride` field (`'light' | 'dark' | null`) is the
 * single source of truth — it is persisted to disk via tauri-plugin-store,
 * so an explicit override survives an app relaunch. `null` means "follow
 * system". This module only knows how to *resolve* an override into an
 * actual `data-theme` attribute; it holds no state of its own.
 */

export type ThemeOverride = 'light' | 'dark' | null;

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(override: ThemeOverride): 'light' | 'dark' {
  return override ?? (prefersDark() ? 'dark' : 'light');
}

/** Sets `data-theme` on <html> to the resolved value. */
export function applyTheme(override: ThemeOverride): void {
  document.documentElement.dataset.theme = resolveTheme(override);
}

/** Subscribe to system preference changes. */
export function watchSystemTheme(onchange: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onchange);
  return () => mq.removeEventListener('change', onchange);
}

/** Next override when the user forces the other theme, per the currently resolved one. */
export function flipTheme(current: ThemeOverride): ThemeOverride {
  return resolveTheme(current) === 'dark' ? 'light' : 'dark';
}
