# Live reload

PeekMD watches every open file for changes and scrolls the viewport to the first modified block within 100 ms of a save.

## File watcher design

**Source:** `src-tauri/src/watcher.rs`, struct `WatcherState`.

The watcher is built on `notify 8` + `notify-debouncer-mini 0.7`. Instead of watching individual files directly, PeekMD watches each file's **parent directory** with `RecursiveMode::NonRecursive`:

```rust
inner.debouncer.as_mut().unwrap().watcher()
    .watch(&parent, RecursiveMode::NonRecursive)
    .map_err(|e| e.to_string())?;
```

**Why parent-dir watching?** Many editors (Vim, Emacs, many JetBrains tools) write saves as an atomic rename: they write to a temp file and then `rename()` it over the original. A watch on the original inode misses this — the inode is replaced, not modified. Watching the parent directory catches both in-place writes and rename-swaps via a single `DebouncedEventKind::Any` event on the path.

A reference count per directory (`watched_dirs: HashMap<PathBuf, usize>`) ensures that a directory is unwatched only when the last file from it is closed. `WatcherState::unwatch` decrements the count and calls `d.watcher().unwatch(parent)` when it reaches zero.

## Debounce

The debouncer is created with a 100 ms window:

```rust
let d = new_debouncer(Duration::from_millis(100), move |res: DebounceEventResult| {
    ...
});
```

Rapid saves (autosave on keystroke, format-on-save followed by a second write) are coalesced into a single event. Only events for paths in `watched_files` are forwarded; events for other files in the same directory (siblings, temp files) are silently dropped.

## Events

Two events are emitted to the frontend via `AppHandle::emit`:

| Event | Payload | When |
| --- | --- | --- |
| `file-changed` | `{ path: string, mtime: u64 }` | `fs::metadata` succeeded after the debounce — file still exists |
| `file-removed` | `{ path: string }` | `fs::metadata` failed after the debounce — file gone from disk |

The `mtime` in `file-changed` is the file's modification time in Unix seconds, read from `std::fs::metadata(&path).modified()`.

## Frontend event handling

**Source:** `src/lib/watcher.ts`, `initWatcher(getContainer)`.

```ts
listen<{ path: string; mtime: number }>('file-changed', async (e) => {
    const prevHtml = doc.html;
    await st.markDirty(e.payload.path, e.payload.mtime);
    if (st.activeDocId === e.payload.path) {
        const after = ...openDocs.find(d => d.path === e.payload.path)?.html;
        if (after && after !== prevHtml) scrollToChange(prevHtml, after, container);
    }
});

listen<{ path: string }>('file-removed', (e) => {
    useStore.getState().markRemoved(e.payload.path);
});
```

### Active vs inactive docs

`markDirty` (in `src/store.ts`) checks whether the changed file is the active document:

- **Active doc:** calls `invoke('render_markdown', { path })` immediately, replaces `html` / `headings` / `mtime`, keeps `dirty: false`. The scroll-to-change algorithm then runs.
- **Inactive doc:** sets `dirty: true` and updates `mtime`. The sidebar shows a dirty dot. Re-render happens when the user activates that doc.

This keeps background files from consuming render cycles while the user is reading a different document.

### markRemoved path

On a `file-removed` event, `markRemoved(path)` sets `doc.removed = true` on the matching open doc. The doc stays in the sidebar with a `[removed]` badge. The last rendered HTML remains visible. No automatic close — the user decides when to close it.

## Scroll-to-change algorithm

**Source:** `src/lib/scrollToChange.ts`.

After a re-render, `scrollToChange(prevHtml, nextHtml, container)` finds the first differing block and scrolls to it:

1. Parse both HTML strings into detached `Document` objects using `DOMParser`.
2. Compare top-level children (i.e., direct children of `<body>`) pairwise by:
   - `data-sourcepos` attribute — the source line range comrak annotates on every block element.
   - `textContent` — catches content changes within the same source range (e.g., editing a word on a line that doesn't shift surrounding blocks).
3. The first index where either attribute differs, or where one side has no element (insertion/deletion at the end), is `targetIdx`.
4. Map `targetIdx` back to a live DOM element: `container.querySelectorAll('.markdown-body > *')[targetIdx]`.
5. Check visibility: if the element's bounding rect is already fully inside the container's viewport, skip the scroll.
6. Otherwise: `el.scrollIntoView({ block: 'center', behavior: 'smooth' })`.
7. Add `.change-flash` CSS class; remove it after 1600 ms.

The algorithm is DOM-level, not source-level. It does not parse Markdown or inspect comrak's AST — it only compares the rendered output. This works because `render.sourcepos = true` embeds the source line mapping in every block element, so any change that shifts lines shows up as a `data-sourcepos` divergence even if the HTML text content is identical.

If no differing block is found (`targetIdx < 0`), the function returns without scrolling or flashing. This handles the case where a re-render produces identical output (e.g., a whitespace-only change in a blank line).
