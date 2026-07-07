# PeekMD Documentation

PeekMD is a fast, offline, GitHub-flavored Markdown previewer for macOS. It lives next to your editor — open one file or many, and every save scrolls the viewport to the changed block and flashes it. Not an editor; not a cloud app. A reader that stays in sync.

## Quick start

```
# Build and run in development
bun run tauri dev

# Open a file from the command line
/Applications/PeekMD.app/Contents/MacOS/PeekMD ~/notes/README.md

# Install from DMG (signed build)
open PeekMD-0.1.0-aarch64.dmg
```

After launch, press `⌘O` to open files via the picker, drag Markdown files onto the sidebar or window, or double-click any `.md` / `.markdown` / `.mdown` / `.mkd` file in Finder.

## Using PeekMD

| Topic | File |
| --- | --- |
| Keyboard shortcuts | [keyboard-shortcuts.md](keyboard-shortcuts.md) |
| Sidebar — open docs, recently closed, context menu | [sidebar.md](sidebar.md) |
| Live reload and scroll-to-change | [live-reload.md](live-reload.md) |
| Session persistence | [persistence.md](persistence.md) |

## Internals

| Topic | File |
| --- | --- |
| Markdown rendering (comrak, heading extraction, RenderedDoc) | [rendering.md](rendering.md) |
| IPC surface — commands, events, capabilities | [ipc.md](ipc.md) |

## Development

The project is a standard Tauri v2 workspace:

```
src/              React + TypeScript frontend (Vite 7, Tailwind v4)
  components/     UI components
  lib/            Keybindings, watcher, persistence, scroll-to-change, fuzzy, theme, mdImages
  store.ts        Zustand 5 store — single source of truth
src-tauri/src/    Rust backend
  lib.rs          App entry, plugin registration, menu event handler
  render.rs       comrak invocation, heading extraction, RenderedDoc
  watcher.rs      notify 8 + notify-debouncer-mini, WatcherState
  commands.rs     Tauri command handlers, context menu logic
  persistence.rs  (stub; session state is handled by tauri-plugin-store)
```

Build requirements: Rust stable, Bun, Xcode Command Line Tools (macOS 14+, Apple Silicon).

## Testing

```
bun run test                              # frontend unit tests (vitest + jsdom)
cargo test                                # (from src-tauri/) Rust unit tests
bunx playwright test --project=browser    # e2e — headless Chromium, IPC mocked, no app needed
bunx playwright test --project=tauri      # e2e — drives the real running app (needs `bun run tauri dev`)
```

Unit tests are colocated with the code they cover (`*.test.ts` next to the module, `#[cfg(test)] mod tests` at
the bottom of the Rust file). E2E specs live in `e2e/tests/`; `e2e/fixtures.ts` boots the app with a seeded
document via a mocked `take_pending_paths`, `e2e/empty-fixtures.ts` boots with none — see either file for the
full set of mocked IPC commands.
