# Sidebar

The sidebar has two sections: **Open Documents** (top) and **Recently Closed** (bottom). It is rendered by `src/components/Sidebar.tsx` and driven entirely by Zustand store state — there is no sidebar-specific backend.

```
┌─ Open Documents ──────────────┐
│ ▸ SPEC.md              •  ×   │  ← active row, dirty dot, close on hover
│   README.md                   │
│   notes.md          [removed] │  ← removed badge (file deleted from disk)
├─ Recently Closed ─────────────┤
│   old-draft.md      just now  │
│   ideas.md          2h ago    │
└───────────────────────────────┘
```

## Open Documents section

Each row is rendered by `src/components/SidebarRow.tsx`. The row state comes from the `Doc` type in `src/store.ts`:

```ts
type Doc = {
  path: DocId;    // absolute path; also the unique id
  title: string;  // file stem (no extension)
  html: string;
  headings: Heading[];
  mtime: number;  // Unix seconds from fs::metadata
  dirty: boolean;
  removed?: boolean;
};
```

### Active row

The row matching `activeDocId` is highlighted. Activating a row:

1. Sets `activeDocId`.
2. Clears the row's `dirty` flag (`dirty: false`).
3. Pushes the previous active doc onto `navBack` (unless `pushHistory: false` is passed — as in back/forward navigation).
4. Clears `navForward`.

### Dirty dot

A dot indicator appears when `doc.dirty === true`. This means the file changed on disk while this doc was not the active document. When the user switches to a dirty doc it is immediately re-rendered (`markDirty` re-renders only if the doc is currently active; otherwise it sets the flag) and the dot clears.

The dot is frontend-only — it reflects the `dirty` field in the Zustand store. No Rust state tracks dirtiness.

### Removed badge

When the `file-removed` event arrives (see [live-reload.md](live-reload.md)), `markRemoved` sets `doc.removed = true`. The sidebar row shows a `[removed]` badge. The doc stays open so the user can read its last-rendered HTML and copy content before closing. Frontend-only — Rust emits the event and takes no further action.

### Close button

The close button (`×`) is visible on hover. Clicking it calls `store.close(path)`, which:

1. Prepends a `RecentEntry` to `recentlyClosed`, capped at 20.
2. Removes the doc from `openDocs`.
3. Picks a new active doc (the next doc in the list, or the previous if at the end).
4. Calls `invoke('unwatch', { path })` to stop the file watcher for this path.
5. Prunes the closed path from `navBack` and `navForward`.

## Recently Closed section

Stores the last 20 closed documents, newest first. Rendered as a plain list of buttons; each shows the document title and a relative timestamp (`timeAgo` from `src/lib/timeAgo.ts`). Hovering over a row shows the full absolute path via `title` attribute.

Clicking a recently closed row calls `reopenRecent(path)`, which:

1. Calls `openFile(path)`.
2. `openFile` unconditionally strips the path from `recentlyClosed` at the start of every open — so the entry disappears whether the file is opened via the recently-closed list, a CLI argument, drag-drop, Open With, or the Command Palette.
3. If the file no longer exists on disk, the `render_markdown` invocation throws; the error is surfaced via `lastError` and the entry is not re-added.
4. When the user later closes the document again, `close` prepends a fresh `RecentEntry` (updated `closedAt` timestamp) to `recentlyClosed`.

Reopened docs are placed at the end of `openDocs` (same as any newly opened file), not at their original position.

The section is hidden when `recentlyClosed` is empty.

## Right-click context menu

Right-clicking a sidebar row invokes the `show_sidebar_context_menu` Tauri command (defined in `src-tauri/src/commands.rs`). This pops a native macOS `NSMenu` anchored to the window.

| Menu item | Action |
| --- | --- |
| Reveal in Finder | `invoke('reveal_in_finder', { path })` via `tauri-plugin-opener` |
| Copy Path | `invoke('copy_path', { path })` — writes plain text to clipboard |
| Copy as HTML | `invoke('copy_html', { html })` — writes the rendered HTML for this doc to clipboard (both plain and HTML representations via `tauri-plugin-clipboard-manager`) |
| Close | `store.close(path)` |
| Close Others | `store.closeOthers(path)` — calls `close` on every other open doc |

The menu selection is not delivered back through the command's return value. Instead, `show_sidebar_context_menu` stores the target path in a `ContextMenuTarget` managed state before calling `popup()`, and a single `on_menu_event` handler registered in `lib.rs::setup` emits a `sidebar-menu-click` Tauri event with `{ action, path }`. `Sidebar.tsx` listens for this event and dispatches the appropriate store action or `invoke` call.

This indirection exists because Tauri's `popup()` API requires a `Window` reference obtained via `app.get_webview_window("main")`. The `ContextMenuTarget` state prevents stale path captures from lingering closures across multiple right-clicks.

## Frontend vs Rust

| Feature | Layer |
| --- | --- |
| Dirty dot | Frontend (Zustand `dirty` field) |
| Removed badge | Frontend (Zustand `removed` field, set on `file-removed` event) |
| Open/close/activate logic | Frontend (Zustand actions) |
| File watcher registration | Rust (`watch_paths` / `unwatch` commands via `WatcherState`) |
| Context menu popup | Rust (`show_sidebar_context_menu`, native `NSMenu`) |
| Reveal in Finder | Rust (`reveal_in_finder` via `tauri-plugin-opener`) |
| Copy Path | Rust (`copy_path` via `tauri-plugin-clipboard-manager`) |
| Copy as HTML | Rust (`copy_html` via `tauri-plugin-clipboard-manager`) |
