# Keyboard shortcuts

PeekMD uses macOS-native `⌘` (Command) key chords throughout. All shortcuts are registered at the `window` level; no focus on a specific element is required unless noted.

## Global (always active)

These handlers live in `src/lib/keybindings.ts`, installed once by `installGlobalKeybindings()` in `App.tsx`. They are suppressed entirely while the Command Palette or Find bar is open (`ui.paletteOpen || ui.findOpen`) — otherwise a background shortcut like `⌘W` could close the active document out from under an open overlay. The palette and find bar own all keyboard input while open; they bind `⌘K` / `⌘F` / `Esc` / arrow keys directly on their own input element, independent of this global handler.

| Chord | Action | Notes |
| --- | --- | --- |
| `⌘O` | Open file picker | Accepts `.md`, `.markdown`, `.mdown`, `.mkd`. Multi-select enabled. |
| `⌘W` | Close active document | No-op when no document is open. Sends the doc to Recently Closed. |
| `⌘R` | Force re-render | Invokes `render_markdown` on the active file, bypassing the watcher. No-op when no document is open. |
| `⌘\` | Toggle sidebar | Calls `setSidebar(!sidebarVisible)`. |
| `⌘⇧D` | Toggle theme | Flips `ui.themeOverride` between `'light'` and `'dark'`; no shortcut returns to `null` (system). |
| `⌘←` | Navigate back | Pops `navBack`, pushes current doc onto `navForward`. No-op when `navBack` is empty. |
| `⌘→` | Navigate forward | Pops `navForward`, pushes current doc onto `navBack`. No-op when `navForward` is empty. |
| `⌘P` | Print / Save as PDF | Calls `window.print()`; triggers the macOS native print dialog. |
| `⌘1` – `⌘9` | Activate document N | Activates `openDocs[N-1]` by position. No-op if that slot is empty. |

## Document navigation

| Chord | Action | Notes |
| --- | --- | --- |
| `⌘←` | Navigate back in history | History is per-session; not persisted across launches. Clears `navForward`. |
| `⌘→` | Navigate forward in history | No-op when `navForward` is empty. |

Back/forward buttons appear in the top bar only when `navBack.length + navForward.length > 0`. See `src/components/TopBar.tsx`.

## Sidebar

| Chord | Action | Notes |
| --- | --- | --- |
| `⌘\` | Toggle sidebar visibility | Handled in `keybindings.ts`. |
| `⌘1` – `⌘9` | Jump to Nth open document | Handled in `keybindings.ts`. |
| `⌘W` | Close active document | Handled in `keybindings.ts`. |

## Find / Palette

These bindings are registered by their respective components, not by `keybindings.ts`.

| Chord | Action | Component | Notes |
| --- | --- | --- | --- |
| `⌘K` | Open / close command palette | `CommandPalette.tsx` | Second `⌘K` or `Esc` closes. |
| `Esc` | Close command palette | `CommandPalette.tsx` | Only when palette is open. |
| `⌘F` | Open find bar | `FindBar.tsx` | Always opens (even if already open, it re-focuses). |
| `Esc` | Close find bar | `FindBar.tsx` | Restores original document HTML. |
| `↑` / `↓` | Navigate results | `CommandPalette.tsx` | Wraps at the list boundaries. |
| `Enter` | Run selected result | `CommandPalette.tsx` | Runs the top result when nothing is explicitly selected. |
| `Enter` | Cycle to next match | `FindBar.tsx` | Wraps from last match back to first. |

## Theme / UI

| Chord | Action | Notes |
| --- | --- | --- |
| `⌘⇧D` | Toggle theme override | Flips between light and dark, based on the currently resolved theme (system preference the first time it's pressed). There is no shortcut back to "follow system" — matches the SPEC. Persisted in `ui.themeOverride` and re-applied on the next launch (see [persistence.md](persistence.md#theme)). |
| `⌘⇧T` | Toggle table of contents | Registered by `TOC.tsx`. TOC auto-hides below 1200 px regardless of this setting. |
