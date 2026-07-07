# PeekMD — Specification

A fast, offline, GitHub-flavored Markdown previewer for macOS. Replaces Marked 2.

Written as a Tauri v2 app: Rust backend, WKWebView frontend. Not an editor — a reader that lives next to your editor and stays in sync with the file on disk.

## Non-goals

- Editing, WYSIWYG, or any typing surface. Selection + copy only.
- Cloud sync, accounts, telemetry, or auto-update.
- Plugin marketplace or user-scripting.
- Windows / Linux for v1. The bundle, code signing, and window chrome target macOS 14+ on Apple Silicon.

Any of these can happen later; v1 stays focused.

## Product surface

### Core

1. **Open Markdown files.**
   - File picker (⌘O), drag-and-drop onto sidebar or window, CLI `peekmd file.md`, macOS "Open With".
   - macOS file-association on `.md`, `.markdown`, `.mdown`, `.mkd`.
2. **GitHub-flavored rendering.**
   - Tables, task lists, strikethrough, autolinks, footnotes, alerts (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!IMPORTANT]`, `[!CAUTION]`).
   - Heading anchors, `<code>` in GitHub style, blockquotes, ordered/unordered lists with nesting.
   - Inline footnotes, superscript, subscript, `==highlight==`, `++inserted text++`, `__underline__`.
3. **Live reload with scroll-to-change.**
   - `notify` watches the open file; a 100 ms debounce coalesces rapid saves.
   - After re-render, the viewport scrolls to the first changed block and flashes it (yellow, 1.6 s).
   - Scroll position within unchanged regions is preserved.
4. **Multi-document sidebar.**
   - Every opened file is one row. Active row highlighted; dirty dot when the file has changed since last view; ×-on-hover closes.
   - Keyboard: ⌘1..9 jump to slot, ⌘W closes active, ⌘\ toggles sidebar.
5. **Light and dark theme.**
   - Follows system by default; ⌘⇧D forces the other.
   - Uses `github-markdown.css` (auto light/dark variant, vendored) plus a matching syntect theme.
6. **Syntax highlighting.**
   - Server-rendered by comrak + syntect. GitHub Light / GitHub Dark themes.
   - No client-side highlight.js in the final build — comrak emits the classes and the CSS is vendored.

### Included in v1

7. **Command palette (⌘K).**
   - Fuzzy search across open docs, recently closed docs, headings in the active doc, and every named command (toggle sidebar, print, reveal in Finder, …).
8. **In-doc find (⌘F).**
   - Styled overlay, not the browser's default. Enter cycles matches, Esc closes.
9. **Table of contents.**
   - Right rail, auto-generated from H2/H3, scroll-spy highlights the current section.
   - Close button (×) on the rail. Once hidden, a "☰ TOC" button appears in the topbar. ⌘⇧T toggles.
   - Auto-hidden below 1200 px window width.
10. **Print / Save as PDF (⌘P).**
    - Uses the native macOS print dialog. Users get "Save as PDF" from the PDF ▾ menu.
    - Print stylesheet strips app chrome and widens the article for the page.
11. **Reveal in Finder / Copy path** on the sidebar row's context menu.
12. **Session restore.**
    - Persists: open document list, active doc, right-pane doc if any, sidebar visibility, TOC visibility, theme override, window bounds.
    - Restored on next launch. Missing files are dropped from the list with a one-time toast.
13. **Recently Closed.**
    - Dedicated sidebar section below the open docs; last 20 entries, most recent on top.
    - Click to reopen. Also surfaced in the command palette. Persisted across sessions.
    - Path shown as secondary text; hover for the full path.
14. **Drag document out to a new window.**
    - Grab a sidebar row and drag past the app window bounds. On drop, PeekMD spawns a new Tauri window showing that document with the sidebar hidden (single-doc mode).
    - Same file watcher; both windows update in sync when the file changes on disk.
    - Closing a detached window returns the doc to the parent window's Recently Closed if it wasn't open there.
15. **Mermaid diagrams.**
    - Detect ` ```mermaid ` code blocks. Render client-side with a vendored `mermaid.tiny.min.js`.
    - Loaded lazily — only if a fence is present in the current document.
16. **Document link navigation.**
    - Clicking a relative link to another `.md` file (e.g. `[see also](../other.md)`) opens that file in PeekMD: switches to it if already open, otherwise opens it and adds it to the sidebar.
    - Absolute `file://` paths to `.md` files are treated the same way.
    - Non-markdown links open in the default browser via `tauri-plugin-opener`.
    - Navigation history is maintained per window: ⌘← goes back, ⌘→ goes forward. A back/forward button pair appears in the topbar when history depth > 1.
    - History is not persisted across sessions — it resets on launch.

### Deferred to v2

- **Split view.** Sidebar rows expose a split icon (rectangle, right half filled) that opens the doc as a right pane beside the current one, with pane-level swap (⇄) and close (✕) controls. The v1 UI is designed with the sidebar API this needs; the split feature itself is v2.
- Custom CSS overrides (drop-in `theme.css`).
- Math via KaTeX (`$…$`, `$$…$$`).
- Folder mode (open a directory, sidebar shows a tree).
- URL scheme `peekmd://open?path=…` for editor integrations.
- Presentation mode.
- Readability stats (word count, reading time).
- Cross-platform builds.

## Interaction details

### Live reload & scroll-to-change

- `notify` watches every open file plus the parent directory (some editors rename-swap).
- Events debounce for 100 ms. On flush, PeekMD re-reads the file and re-renders through comrak.
- comrak is called with `render.sourcepos = true`, so every top-level HTML element carries `data-sourcepos="startLine:startCol-endLine:endCol"`.
- Change detection compares the previous and new HTML per top-level block. The first block whose `data-sourcepos` maps to a changed source range is the scroll target.
- Scroll behavior: `scrollIntoView({ block: "center", behavior: "smooth" })`, then add `.change-flash` for 1.6 s.
- If the viewport already contains the changed block, no scroll — just the flash.

### Multi-document sidebar

- Order = order of opening. Reopening a document from Recently Closed places it at the top.
- Dirty dot means "changed on disk since you last looked at it". Cleared when the doc becomes active.
- Right-click menu: Reveal in Finder, Copy path, Copy as HTML, Close, Close others.

### Drag-out semantics

- `dragstart` on a sidebar row sets a custom drag image and payload `application/x-peekmd-doc: <id>`.
- If `dragend` fires with `dropEffect === "none"` and the pointer is outside the app window (`screenX/screenY` outside `window` bounds), PeekMD invokes a Rust command `spawn_detached_window(id)`.
- The new window opens next to the pointer, 640 × 420 by default, sidebar hidden.
- Both windows share the file watcher and settings store; each maintains its own scroll position and TOC state.

### Sidebar sections

```
┌─ Open Documents ──────────┐
│ ▸ SPEC.md          • ×    │  ← dirty dot, close on hover
│   README.md              │
│   notes.md               │
├─ Recently Closed ─────────┤  ← last 20, click to reopen
│   old-draft.md   just now │
│   ideas.md       2h ago   │
└───────────────────────────┘
```

### Command palette

- ⌘K opens; ⌘K again or Esc closes.
- Sources: open docs, recently closed docs (`Reopen: <name>`), headings in the active doc (`Jump to: <heading>`), and the fixed command list.
- Fuzzy match on label; secondary line shows the path or keybinding.
- Enter runs the top result; ↑↓ navigate.

### Keybindings

| Chord | Action |
| --- | --- |
| ⌘O | Open file |
| ⌘K | Command palette |
| ⌘F | Find in document |
| ⌘P | Print / Save as PDF |
| ⌘\\ | Toggle sidebar |
| ⌘⇧T | Toggle table of contents |
| ⌘⇧D | Toggle theme |
| ⌘1..9 | Activate document N |
| ⌘W | Close active document |
| ⌘R | Force re-render current file |
| ⌘← | Navigate back in history |
| ⌘→ | Navigate forward in history |

## Architecture

### Stack

Mirrors klar where it makes sense.

| Layer | Choice | Notes |
| --- | --- | --- |
| Desktop framework | Tauri v2 | WKWebView on macOS. `macos-private-api` for drag/drop signaling only if needed. |
| Frontend | React 19 + TypeScript 5.8 | Vite 7, Tailwind v4. |
| State | Zustand 5 | Docs, active id, right-pane id, recent list, ui prefs. |
| Bundler | Vite 7 | Same layout as klar. |
| Icons | `lucide-react` + inline SVG for the split glyph | |

### Rust dependencies

| Crate | Version | Role |
| --- | --- | --- |
| `tauri` | 2 | Runtime |
| `tauri-plugin-fs` | 2 | Reading picked/dropped files |
| `tauri-plugin-dialog` | 2 | Open-file dialog |
| `tauri-plugin-opener` | 2 | Reveal-in-Finder, copy-to-clipboard opens |
| `tauri-plugin-window-state` | 2 | Persist window bounds |
| `tauri-plugin-store` | 2 | Session state, recently-closed list |
| `comrak` | 0.52 (features: `syntect`) | Markdown → HTML with `data-sourcepos` and heading anchors |
| `notify` | 8 | File watcher |
| `notify-debouncer-mini` | 0.7 | Save-storm coalescing |
| `serde`, `serde_json`, `thiserror`, `tracing`, `tracing-subscriber`, `tracing-appender`, `dirs`, `parking_lot` | — | Same shape as klar |

No SQLite, no HTTP client, no audio.

### Renderer choice — comrak

`comrak 0.52` (BSD-2-Clause), full GFM (670/670 tests pass). Chosen over alternatives because:

- Emits `data-sourcepos` on every element when `options.render.sourcepos = true`. Scroll-to-change is one HTML query away. `pulldown-cmark` requires hand-rolling a source map over its event stream; `markdown-rs` has position data in the AST but never lands it in HTML output.
- Native heading anchor generation for the TOC.
- Built-in syntect adapter for syntax highlighting — no JS payload for code blocks.
- Plugin/adapter API leaves room for the Mermaid handoff (emit unmodified `<pre class="language-mermaid">` blocks and let the frontend hydrate them).

Comrak configuration:

```rust
let mut opts = comrak::Options::default();
// GFM extensions
opts.extension.table = true;
opts.extension.tasklist = true;
opts.extension.strikethrough = true;
opts.extension.autolink = true;
opts.extension.footnotes = true;
opts.extension.inline_footnotes = true;
opts.extension.tagfilter = true;
opts.extension.alerts = true;
// Comrak extras — useful in real-world Markdown docs
opts.extension.superscript = true;       // e^2^
opts.extension.subscript = true;         // H~2~O  (overrides single-tilde strikethrough)
opts.extension.highlight = true;         // ==mark==
opts.extension.insert = true;            // ++ins++
opts.extension.underline = true;         // __underline__ (replaces bold)
opts.extension.footnotes = true;
opts.extension.multiline_block_quotes = true;
opts.extension.front_matter_delimiter = Some("---".into()); // silently strip YAML front matter
// Navigation: rewrite relative .md links before emitting HTML
opts.extension.link_url_rewriter = Some(Arc::new(peekmd_link_rewriter));
// Heading anchors (used by TOC)
opts.extension.header_id_prefix = Some("peekmd-".into());
opts.render.sourcepos = true;
opts.render.unsafe_ = false;
```

**Not enabled:**
- `math_dollars` / `math_code` — deferred to v2 (KaTeX rendering not wired yet; comrak emits bare `<span data-math-style>` with no renderer)
- `wikilinks_*` — non-standard syntax, no clear demand for v1
- `shortcodes` — requires the `shortcodes` cargo feature and emoji data; adds binary size
- `description_lists` — not compatible with `render.sourcepos` (noted in comrak source); would break scroll-to-change
- `greentext` — changes blockquote semantics in ways that break standard Markdown
- `spoiler` / `subtext` / `cjk_friendly_emphasis` — niche; can be added without API changes

Syntect uses a custom `SyntaxHighlighterAdapter` (not the built-in inline-style one) that calls `ClassedHTMLGenerator` with `ClassStyle::Spaced`. CSS is generated at build time via `css_for_theme_with_class_style()` and vendored. The theme swap is a stylesheet toggle — no re-render required.

### Offline / vendoring

The app ships zero network dependencies. Everything under `src/vendor/`:

- `github-markdown.css` (light + dark)
- Syntect-compatible GitHub Light / GitHub Dark class stylesheets
- `mermaid.tiny.min.js` (loaded only when a Mermaid fence is present; tiny build omits Mindmap/Architecture/KaTeX — acceptable for a Markdown reader)
- `@fontsource/inter` and `@fontsource/jetbrains-mono` (already offline via npm)

No CDN references. Build fails CI if `grep -r "https://cdn"` finds anything in the shipped bundle.

### Windows

- **Main window**: label `main`, 1000 × 720 default, min 700 × 500, decorations on. Restored via `tauri-plugin-window-state`.
- **Detached window**: label `doc-<uuid>`, 640 × 420, spawned by `spawn_detached_window`. Sidebar route parameter set to hidden. Not tracked by window-state (each new drag gets a fresh position).

### IPC surface

Rust commands exposed to the frontend:

```rust
open_files(paths: Vec<PathBuf>) -> Vec<DocMeta>
watch_paths(paths: Vec<PathBuf>) -> ()
render_markdown(path: PathBuf) -> RenderedDoc   // { html, headings, mermaid_ids, mtime }
unwatch(path: PathBuf) -> ()
spawn_detached_window(doc_id: String) -> ()
reveal_in_finder(path: PathBuf) -> ()
copy_html(html: String) -> ()
resolve_md_link(base: PathBuf, href: String) -> Option<PathBuf>  // resolves relative .md links
```

Events emitted:

```
file-changed   { path, doc_id }         // debounced
file-removed   { path, doc_id }
```

Rendering happens on demand: the frontend receives a `file-changed` event and asks for a fresh `render_markdown`. The Rust side never pushes HTML unsolicited.

### Change detection

For each `render_markdown` call the frontend keeps the last HTML for that doc. On the new HTML it walks top-level elements and compares by their `data-sourcepos` and text hash. The first block that differs is the scroll target. This is DOM-level, not source-level, so it survives comrak's arena-tree without wiring a second pass in Rust.

## State persistence

Stored via `tauri-plugin-store` in `~/Library/Application Support/com.peekmd.desktop/state.json`:

```json
{
  "openDocs": ["<abs-path>", "..."],
  "activeDoc": "<abs-path>",
  "rightPaneDoc": null,
  "recentlyClosed": [
    {"path": "<abs-path>", "closedAt": "2026-07-01T12:34:56Z"}
  ],
  "ui": {
    "sidebarVisible": true,
    "tocVisible": true,
    "themeOverride": null
  }
}
```

Navigation history (`navBack`, `navForward` stacks of paths) is in-memory only — not persisted.

Write is debounced 500 ms. Migration between versions is a plain `version` field on the JSON — if missing or lower, defaults win and the old file is renamed `state.json.bak`.

## Distribution

- macOS 14 (Sonoma) or later, Apple Silicon.
- Signed DMG via GitHub Releases.
- `scripts/release-signed.sh` / `release-unsigned.sh` mirroring klar. Same env-var contract (`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`).
- No auto-updater. No `latest.json`.

`Info.plist` declares the app as the handler for `public.plain-text` files with `.md`, `.markdown`, `.mdown`, `.mkd` extensions.

## Logging

`tracing` + `tracing-appender`, rolling daily, 7-day retention, `~/Library/Logs/PeekMD/`. `INFO` in release, `DEBUG` in dev.

Log points: file open, file change, render duration, spawn detached window, session save/restore, unhandled errors. No file contents in logs.

## Acceptance

v1 is done when:

- Every item in **Core** and **Included in v1** ships and works on a fresh Sonoma install.
- `cargo build --release` produces a signed DMG under 20 MB.
- A 10 MB Markdown file opens in under 500 ms end-to-end.
- Scroll-to-change lands on the correct block for 20 hand-picked edit types (heading rename, table cell change, code fence change, list reorder, list-item add, blockquote add, paragraph split, footnote add, image swap, alert kind change, and their inverses).
- No network calls at runtime — verified by running the app with the network disabled.
