# PeekMD — Implementation Plan

Three phases, each independently shippable. Every phase ends with a working, dogfoodable app; nothing is a stub waiting on the next phase.

## Phase 1 — Foundation

**Goal:** open one file and render it correctly.

- Scaffold Tauri v2 + React + TS + Vite + Tailwind, matching klar's layout.
- Vendor `github-markdown.css` (light + dark), the syntect GitHub-theme class stylesheets, and the Inter / JetBrains Mono webfonts. Wire CI to reject any `https://cdn` reference in the shipped bundle.
- Wire `comrak 0.52` with all v1 extensions on and `render.sourcepos = true`. Expose `render_markdown` as a Tauri command.
- Basic app shell: single window, titlebar with breadcrumb, main pane with the rendered `.markdown-body`, print-friendly stylesheet.
- File open: CLI arg, `⌘O` file picker, drag-drop onto the window, macOS Open-With via `Info.plist` file association.
- Light / dark theme toggle (`⌘⇧D`), following system by default.
- Logging via `tracing` + rolling file appender under `~/Library/Logs/PeekMD/`.
- Release scripts (signed + unsigned DMG) ported from klar. First internal DMG ships at the end of this phase.

**Exit criteria:** double-click a `.md` file, see it rendered in GitHub style, dark mode works, DMG installs on a fresh Sonoma machine.

## Phase 2 — Live and multi-doc ✓ COMPLETE

**Goal:** the sidebar, the file watcher, and everything that makes PeekMD replace Marked day-to-day.

- File watcher (`notify 8` + `notify-debouncer-mini 0.7`), 100 ms debounce, `file-changed` event to the frontend.
- Scroll-to-change: DOM-level diff of `data-sourcepos` blocks, smooth scroll and 1.6 s flash on the target.
- Multi-document sidebar: open list, active row, dirty dot, hover-close, ⌘1..9 / ⌘W / ⌘\.
- Recently Closed section (last 20, click to reopen, persisted).
- Session restore via `tauri-plugin-store`: open docs, active id, sidebar visibility, theme override, window bounds.
- Command palette (⌘K) across open docs, recently closed, active-doc headings, and named commands.
- In-doc find (⌘F) with styled overlay.
- Table of contents right rail: auto from H2/H3, scrollspy, close button, `☰ TOC` topbar re-show, `⌘⇧T`.
- Print / Save as PDF (⌘P) with a tuned print stylesheet.
- Right-click on sidebar rows: Reveal in Finder, Copy path, Copy as HTML, Close, Close others.
- Document link navigation: intercept clicks on relative `.md` links and `file://` `.md` paths; resolve via `resolve_md_link` Rust command; switch to already-open doc or open fresh. Non-markdown links → default browser.
- Navigation history per window: back/forward stacks in Zustand; ⌘← / ⌘→ shortcuts; back/forward buttons in topbar shown when history depth > 1.

**Exit criteria:** open five files, edit any in an external editor, see PeekMD jump to the change and flash it; close and reopen the app — same files, same layout, same theme.

## Phase 3 — Multi-window, Mermaid, and polish

**Goal:** the things that make the app feel finished.

- Drag-out-to-new-window: detect drag past window bounds, spawn a `doc-<uuid>` window in single-doc mode (sidebar hidden), shared file watcher, independent scroll and TOC state.
- Mermaid support: lazy-load a vendored `mermaid.tiny.min.js` only when a document contains a ` ```mermaid ` fence; hydrate blocks after render. (Tiny build: omits Mindmap, Architecture, KaTeX — all acceptable for a Markdown reader; ~half the size of the full bundle.)
- Performance pass: 10 MB Markdown file renders in under 500 ms; scroll-to-change matches the target block on the 20 hand-picked edit types listed in the spec.
- Empty-state, missing-file, and permission-denied paths handled with clear toasts, not silence.
- Accessibility pass: keyboard navigation for every action, visible focus rings, screen-reader labels on icon-only buttons.
- Release polish: app icon, `Info.plist` file-type metadata, notarized signed DMG on GitHub Releases, README with install instructions.

**Exit criteria:** every item in the SPEC's "Included in v1" section works on a fresh Sonoma machine, the acceptance list at the bottom of the SPEC passes, and the split-view sidebar API is in place so v2 can add it without a UI rewrite.
