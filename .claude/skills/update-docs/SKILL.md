---
name: update-docs
description: Keep the PeekMD docs/ folder in sync with the codebase. Use when a feature is added, changed, or removed — or when the user asks to update the docs. Covers all files in docs/.
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Search
  - Find
---

# PeekMD docs update skill

The `docs/` folder is the product specification for everything that is **currently implemented**. It is the source of truth for future maintainers and the input to future planning. Keep it accurate and up to date whenever code changes.

---

## Doc map

| File | What it covers |
|---|---|
| `docs/README.md` | Index hub — product description, quick start, links to all other docs |
| `docs/keyboard-shortcuts.md` | All keyboard shortcuts, grouped by context |
| `docs/sidebar.md` | Open Documents section, Recently Closed, dirty dot, context menu |
| `docs/live-reload.md` | File watcher, debounce, scroll-to-change, dirty-dot vs immediate re-render |
| `docs/persistence.md` | state.json schema, version guard, debounced save, session restore flow |
| `docs/rendering.md` | comrak extensions, sourcepos, heading extraction, RenderedDoc shape |
| `docs/ipc.md` | Full IPC command table, Tauri events, capabilities/permissions |

---

## When to update

Update the relevant doc(s) whenever:

- A new UI component is added or a feature's behaviour changes → the relevant `docs/<feature>.md`
- A keyboard shortcut is added, changed, or removed → `docs/keyboard-shortcuts.md`
- The sidebar gains or loses a feature → `docs/sidebar.md`
- File watcher behaviour or scroll-to-change logic changes → `docs/live-reload.md`
- The persistence schema, version, or restore flow changes → `docs/persistence.md`
- A new comrak extension is enabled or the rendering pipeline changes → `docs/rendering.md`
- A new IPC command or Tauri event is added or removed → `docs/ipc.md`
- A new capability/permission is added to `capabilities/default.json` → `docs/ipc.md`
- A phase completes or deferred items are implemented → update any docs that previously noted "Phase N" deferral

---

## How to update

1. **Read the changed source files** to understand what actually changed — never update docs from memory or assumptions.
2. **Identify the affected doc(s)** using the map above. A single code change often touches more than one doc.
3. **Edit the specific sections** that are affected. Do not rewrite unrelated sections.
4. **Do not document unimplemented features.** If something is deferred to a future phase, note it explicitly (e.g. "Phase 3: split view") or omit it.

---

## Key source locations

| What | Where |
|---|---|
| Keybindings | `src/lib/keybindings.ts`, component-level effects in `TOC.tsx`, `CommandPalette.tsx`, `FindBar.tsx` |
| IPC commands | `src-tauri/src/commands.rs`, `src-tauri/src/render.rs` |
| Tauri events | `src-tauri/src/watcher.rs` (`file-changed`, `file-removed`), `src-tauri/src/commands.rs` (`sidebar-menu-click`) |
| Capabilities | `src-tauri/capabilities/default.json` |
| Persistence schema | `src/lib/persistence.ts` (`Persisted` type, `loadState`, `scheduleSave`) |
| Store shape | `src/store.ts` (`StoreState`, all reducers) |
| Rendering pipeline | `src-tauri/src/render.rs` (`build_options`, `extract_headings`, `RenderedDoc`) |
| Watcher logic | `src-tauri/src/watcher.rs` (Rust), `src/lib/watcher.ts` + `src/lib/scrollToChange.ts` (frontend) |
| Sidebar | `src/components/Sidebar.tsx`, `src/components/SidebarRow.tsx` |
| TOC | `src/components/TOC.tsx` (`TOC`, `TocChip`) |
| CommandPalette | `src/components/CommandPalette.tsx`, `src/lib/fuzzy.ts` |
| FindBar | `src/components/FindBar.tsx` |
| TopBar | `src/components/TopBar.tsx` |

---

## Rules

- Only document what is implemented and verified.
- If a section references something that no longer exists in the code, remove or correct it.
- `docs/ipc.md` is the single source of truth for the IPC surface — never split command documentation across multiple docs.
- Keyboard shortcut tables must match exactly what is registered in `src/lib/keybindings.ts` and the component-level `useEffect` handlers.
- Deferred items (split view, Mermaid, KaTeX, drag-out window, peekmd:// URL scheme) are listed in `docs/README.md` under "Not yet implemented". Do not add stub sections for them in feature docs.
