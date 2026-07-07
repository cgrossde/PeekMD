# Theme system

## Overview

PeekMD uses a three-state theme model, stored in `ui.themeOverride` inside the Zustand store:

| Value | Meaning |
|-------|---------|
| `null` | Follow the operating system preference |
| `'light'` | Force light theme regardless of OS |
| `'dark'` | Force dark theme regardless of OS |

`themeOverride` is included in the persisted state snapshot (see `docs/persistence.md`), so an explicit override survives app restarts. The default value is `null` (follow system).

All styling reacts to a single HTML attribute: `data-theme` on `<html>`. The value is always either `"light"` or `"dark"` — the three-state model is resolved before it reaches the DOM.

---

## Applying the theme

**`src/lib/theme.ts`** contains the low-level primitives. None of them hold state.

```ts
export type ThemeOverride = 'light' | 'dark' | null;

export function resolveTheme(override: ThemeOverride): 'light' | 'dark'
export function applyTheme(override: ThemeOverride): void
export function watchSystemTheme(onchange: () => void): () => void
export function flipTheme(current: ThemeOverride): ThemeOverride
```

`resolveTheme(override)` collapses the three-state value to a concrete string:

- If `override` is `'light'` or `'dark'`, it is returned as-is.
- If `override` is `null`, the result is determined by `window.matchMedia('(prefers-color-scheme: dark)')`.

`applyTheme(override)` calls `resolveTheme` and writes the result to `document.documentElement.dataset.theme`. Every themed CSS rule in the project uses `[data-theme="dark"]` or `:root:not([data-theme="dark"])` selectors, so this single attribute drives the entire visual state.

---

## System theme tracking

`watchSystemTheme(cb)` registers a `change` listener on `window.matchMedia('(prefers-color-scheme: dark)')` and returns an unsubscribe function.

In `App.tsx` the callback is:

```ts
const unsubSystemTheme = watchSystemTheme(() => {
  if (useStore.getState().ui.themeOverride === null) applyTheme(null);
});
```

The guard means the listener only re-applies when the user is following the system (`themeOverride === null`). When an explicit override is set, OS preference changes have no effect.

---

## First-paint

`src/main.tsx` calls `applyTheme(null)` synchronously, before `ReactDOM.createRoot` mounts the app:

```ts
// Best-effort paint before the store hydrates the persisted override (avoids
// a flash of the wrong theme). App.tsx takes over from here once the real
// `ui.themeOverride` is known and keeps it in sync going forward.
applyTheme(null);
```

This sets `data-theme` to the current OS preference immediately, so the page never paints in the wrong theme while React and the persistence layer are initialising. Once `hydrateFromDisk` completes and the store's `ui.themeOverride` is restored, `App.tsx` re-applies the persisted override (which may differ from the system default).

---

## Toggling

**`toggleTheme`** in the store:

```ts
toggleTheme: () => set(s => ({ ui: { ...s.ui, themeOverride: flipTheme(s.ui.themeOverride) } })),
```

`flipTheme(current)` resolves the current override first, then returns the opposite:

```ts
export function flipTheme(current: ThemeOverride): ThemeOverride {
  return resolveTheme(current) === 'dark' ? 'light' : 'dark';
}
```

Because it resolves before flipping, pressing the toggle while following system dark (override `null`, resolved `'dark'`) sets `themeOverride` to `'light'` — locking light mode. The next toggle sets it to `'dark'` (an explicit override, no longer following system).

The keyboard shortcut is `⌘⇧D` (wired via `src/lib/keybindings.ts`).

**`setThemeOverride(null)`** restores system-following behaviour, but there is no keyboard shortcut for it. It can be invoked from the command palette ("Follow system theme").

---

## Vendored CSS

All CSS is bundled at build time. No fonts or stylesheets are fetched from a CDN at runtime.

### `src/vendor/github-markdown.css`

The upstream `github-markdown-css` stylesheet. It scopes its light and dark variable sets inside `@media (prefers-color-scheme: …)` blocks. Because that approach does not respond to a manually forced theme, `src/index.css` repeats the same variable sets unconditionally under `[data-theme="dark"] .markdown-body` and `[data-theme="light"] .markdown-body` selectors. The higher specificity of these rules ensures the `data-theme` attribute always wins over the media query.

### `src/vendor/syntect-github-light.css` and `syntect-github-dark.css`

Generated syntax-highlight stylesheets produced by a Rust build script (`cargo run --bin gen_syntect_css`). Do not edit them by hand.

- `syntect-github-dark.css` scopes all rules under `[data-theme="dark"] .markdown-body`.
- `syntect-github-light.css` scopes all rules under `:root:not([data-theme="dark"]) .markdown-body`.

This means exactly one of the two stylesheets is active at any time, keyed entirely by the `data-theme` attribute.

### Fonts

Fonts are imported in `src/main.tsx` from npm packages and bundled by Vite:

| Package | Weights used |
|---------|-------------|
| `@fontsource/inter` | 400, 500, 600 |
| `@fontsource/jetbrains-mono` | 400, 500 |

Inter is used for the application UI. JetBrains Mono is used for code blocks inside rendered Markdown.

---

## Mermaid

A `useLayoutEffect` in `App.tsx` re-runs `hydrateMermaid` whenever `themeOverride` changes:

```ts
useLayoutEffect(() => {
  const c = docViewRef.current;
  if (!c || !activeDoc) return;
  const theme = resolveTheme(themeOverride);
  void hydrateMermaid(c, theme);
}, [activeDoc?.path, activeDoc?.html, themeOverride]);
```

`resolveTheme` is called here so `hydrateMermaid` always receives a concrete `'light'` or `'dark'` string. See `docs/mermaid.md` for how `hydrateMermaid` uses the theme value.
