# Markdown editor

PeekMD provides a transient CodeMirror source editor for the active Markdown document. Press `⌘Enter` to enter or leave edit mode. PeekMD keeps the rendered preview as the default view and creates one edit session at a time.

**Sources:** `src/App.tsx`, `src/components/MarkdownEditor.tsx`, `src/components/MarkdownPreview.tsx`, `src/store.ts`, and `src/lib/sourcePosition.ts`.

## Opening and closing edit mode

Entering edit mode calls `read_markdown_source` for the active path. The response contains the original source, its line separator, the rendered document, and the `FileRevision` used for conflict detection. PeekMD aborts the transition if the active document changes while the read is in flight.

Leaving edit mode waits for any active save. A dirty draft receives one final save attempt. PeekMD returns to preview only after the session reaches `clean`; conflicts and I/O errors keep the editor open.

`⌘Enter` is the only edit-mode shortcut. See [keyboard-shortcuts.md](keyboard-shortcuts.md) for the complete shortcut table.

## Editor surface

`MarkdownEditor` wraps CodeMirror 6 with Markdown parsing, line numbers, line wrapping, undo history, search bindings, and Tab indentation. The editor displays Markdown punctuation and applies semantic styles to headings, emphasis, links, quotes, and inline code. `⌘`-clicking a Markdown link uses the same navigation path as preview links.

The editor uses the preview's system sans-serif stack, 16 px text, and 24 px line rhythm. It is left-aligned, limited to the preview's 980 px content width, and inset to account for the line-number gutter. Line numbers use the bundled JetBrains Mono face.

## Draft and save states

The store owns one `EditSession`:

```ts
type EditStatus = 'clean' | 'dirty' | 'saving' | 'conflict' | 'error';

type EditSession = {
  path: string;
  draft: Text;
  lineSeparator: string;
  baseRevision: FileRevision;
  status: EditStatus;
  resetGeneration: number;
  latest?: EditableDocument;
  message?: string;
};
```

A CodeMirror document change marks a clean or saving session dirty and schedules a save after 500 ms. `save_markdown_source` compares the expected revision, renders the draft before mutation, writes through the checked file descriptor, syncs it, then verifies the committed bytes. A successful save updates the rendered document and base revision. Edits made during an in-flight save remain dirty and schedule another save.

A revision or inode mismatch enters `conflict` and retains both the draft and latest disk snapshot. The editor offers these recovery actions:

- **Reload from Disk** replaces the draft and increments `resetGeneration`, which rebuilds CodeMirror state.
- **Overwrite Disk** adopts the latest disk revision and retries the draft save.
- **Retry** retries a save after an I/O error.

See [live-reload.md](live-reload.md#active-markdown-editor) for external file changes and [rendering.md](rendering.md#rendereddoc) for the rendered document and revision fields.

## Cursor and scroll transfer

PeekMD retains editor cursor offsets, preview cursors, and source-line scroll anchors per open document for the current app session. These values are not persisted to disk.

When preview mode enters the editor, PeekMD maps the preview cursor through comrak's `data-sourcepos` range. The mapping accounts for UTF-8 source columns, UTF-16 DOM offsets, decoded HTML entities, inline code, emphasis, links, reference links, and non-rendered Markdown punctuation. CodeMirror receives the exact source offset, scrolls it into view, and takes focus.

When the editor returns to preview, PeekMD maps the CodeMirror offset back to a rendered text node. A remembered preview cursor retains its element-level rendered offset and exact source offset. Restoration runs after the preview ref mounts and expires after three unsuccessful animation frames.

Scroll position uses a separate source-line anchor. Multiline rendered blocks estimate the visible source line from the block's height, allowing preview and editor mode to reopen near the same content without coupling scroll state to the cursor.

## Read-only preview cursor

An ordinary preview text click creates a collapsed native selection and a blue overlay caret. The preview remains read-only HTML; it never becomes `contenteditable`. Clicking links, task checkboxes, Mermaid controls, or document whitespace preserves their existing behavior or clears the preview cursor.

Native drag-selection remains a browser selection and does not create a preview cursor. Replacing rendered HTML clears both the native selection and synthetic caret so no range retains text nodes from the previous render.

## Development debug bridge

Vite development builds expose `window.__PEEKMD_DEBUG__`. The typed bridge reports document, edit-session, editor-cursor, preview-cursor, and pending-restoration state. It can set editor positions by source offset or one-based line and column, set preview positions by selector and UTF-16 rendered offset, change modes, open or close files, and refresh the active document.

The bridge and its console capture are guarded by `import.meta.env.DEV`; production bundles contain neither the global nor its implementation. Live cursor scenarios use the bridge. Native drag-selection remains browser-E2E coverage because synthetic WKWebView pointer events do not reproduce native selection reliably.

Run the focused checks with:

```bash
bun run test:debug
bun run test:edit-mode
```

The full debug command grammar, fixture safety rules, and diagnostic-bundle format live in `.claude/skills/debug/SKILL.md`.
