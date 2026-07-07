# Navigation

PeekMD has three navigation mechanisms: a back/forward history stack inside the
Zustand store, in-document link routing, and drag-out to a detached window.

---

## Navigation history

### State

Two arrays live in the Zustand store alongside `activeDocId`:

| Field | Type | Description |
|---|---|---|
| `navBack` | `DocId[]` | Stack of previously active document paths |
| `navForward` | `DocId[]` | Stack of documents that were navigated away from via Back |

Both are plain `string[]` (absolute paths). Neither is persisted to disk —
`hydrateFromDisk` resets them to `[]` unconditionally after restoring the
session, so history starts clean on every launch.

### How entries accumulate

`activate(id, options?)` is the single write point. When called with
`pushHistory` not explicitly set to `false`:

1. If `activeDocId` is non-null and differs from `id`, it is appended to
   `navBack`.
2. `navForward` is cleared.

`openFile` delegates to `activate` after loading a document, so every user
action that opens or switches to a file — opening via ⌘O, drag-drop, clicking a
tab, following a markdown link — pushes the previous document onto `navBack` and
clears `navForward`.

Session-restore calls (`hydrateFromDisk`) pass `pushHistory: false` explicitly,
so reopening the previous session does not populate the history stacks.

### `navigateBack`

```
navBack: [..., A, B]   activeDocId: C   navForward: [D, E]
                           ↓
navBack: [..., A]      activeDocId: B   navForward: [C, D, E]
```

Implementation (`store.ts`):

1. Returns immediately if `navBack` is empty.
2. Pops the last entry (`prev = navBack[navBack.length - 1]`).
3. Atomically writes `navBack` without the last entry and prepends
   `activeDocId` onto `navForward`.
4. Calls `activate(prev, { pushHistory: false })` — the `pushHistory: false`
   flag prevents the activation itself from creating another history entry.

### `navigateForward`

Mirror of `navigateBack`:

1. Returns immediately if `navForward` is empty.
2. Takes the first entry (`next = navForward[0]`).
3. Writes `navForward` without that entry and appends `activeDocId` onto
   `navBack`.
4. Calls `activate(next, { pushHistory: false })`.

### Closing a document

`close(id)` filters `id` out of both `navBack` and `navForward` so dangling
pointers to closed documents cannot appear in the history.

### Back/forward buttons

`TopBar` renders the Back and Forward buttons only when
`navBack.length + navForward.length > 0` — i.e. at least one navigation has
occurred in the session. Each button is disabled (but still visible) when its
own stack is empty.

### Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Navigate back | ⌘← |
| Navigate forward | ⌘→ |

Both are registered in `src/lib/keybindings.ts` as `metaKey + ArrowLeft/ArrowRight`.

---

## Document link navigation

`installMdLinkHandler()` in `src/lib/mdLinks.ts` attaches a capturing
`click` listener to `document`. It runs on every click in the rendered article.

### Routing logic

1. Walks up from the clicked element to the nearest `<a>`.
2. Reads `href`. If there is no href, or it starts with `#` (in-page anchor),
   the event is left alone.
3. Otherwise calls `preventDefault()` and invokes the Rust command
   `resolve_md_link` with the active document's absolute path as `base` and the
   raw `href` string.
4. If `resolve_md_link` returns a path, calls `store.openFile(resolved)`:
   - If that path is already open, the tab is activated (history entry pushed).
   - If it is not open, the document is loaded fresh.
5. If `resolve_md_link` returns `null`, the href is opened in the system
   default browser via `tauri-plugin-opener`.

### `resolve_md_link` (Rust)

Located in `src-tauri/src/commands.rs`.

```
resolve_md_link(base: PathBuf, href: String) -> Option<PathBuf>
```

Steps:

1. Strips a `file://` prefix from `href` if present.
2. Strips any URL fragment (`#…`) from `href`.
3. Returns `None` if `href` is empty after stripping.
4. Resolves the path:
   - If absolute, uses it as-is.
   - If relative, joins it to the parent directory of `base`.
5. Canonicalises the result with `std::fs::canonicalize` (resolves symlinks,
   `..` components). Returns `None` on any I/O error.
6. Checks the extension. Accepted extensions: `md`, `markdown`, `mdown`, `mkd`
   (case-insensitive). Returns `None` for anything else.
7. Returns `Some(canonical)` if the file exists, `None` otherwise.

Non-markdown links — HTTP/HTTPS URLs, PDFs, plain text files, etc. — always
reach step 5 of the routing logic and open in the browser.

---

## Drag-out to a detached window

### Initiating a drag

Each `SidebarRow` is rendered with `draggable={true}` (disabled for documents
marked `removed`). `onDragStart` sets:

```
dataTransfer.effectAllowed = 'move'
dataTransfer.setData('application/x-peekmd-doc', doc.path)
```

### Detecting an out-of-window drop

`onDragEnd` fires regardless of whether the drag succeeded. The handler checks
two conditions:

1. `e.dataTransfer.dropEffect === 'none'` — the drag was not accepted by any
   drop target inside the app.
2. The pointer ended outside the app window bounds:
   ```
   outsideX = screenX < window.screenX  ||  screenX > window.screenX + window.outerWidth
   outsideY = screenY < window.screenY  ||  screenY > window.screenY + window.outerHeight
   ```

Both conditions must be true. When they are, it invokes:

```
invoke('spawn_detached_window', { path, screenX, screenY })
```

The document remains open in the main window.

### `spawn_detached_window` (Rust)

Located in `src-tauri/src/commands.rs`.

```
spawn_detached_window(app, path: String, screen_x: f64, screen_y: f64) -> Result<(), String>
```

1. Generates a UUID and forms the window label `doc-<uuid_simple>`.
2. URL-encodes the file path and builds the URL
   `index.html?detached=<encoded-path>`.
3. Creates a `WebviewWindowBuilder` with:
   - Initial size: 640 × 420 (minimum 480 × 320).
   - Position: `(screen_x, screen_y)` — the exact screen coordinates where
     the drag ended.
   - Title: `PeekMD — <basename>`.
4. Registers an `on_window_event` handler. When the window's `Destroyed` event
   fires, emits the global Tauri event `detached-window-closed` with payload
   `{ "path": "<path>" }`.

### Detached window startup

`App.tsx` reads `detachedPath` from the URL search params at module load:

```ts
const detachedPath = new URLSearchParams(window.location.search).get('detached');
const isDetached = detachedPath !== null;
```

When `isDetached` is true, the one-time setup effect:

- Calls `openFile(decodeURIComponent(detachedPath))` to load the single
  document. This call goes through the normal `openFile` path (renders
  markdown, starts the file watcher).
- Calls `setSidebar(false)` to hide the sidebar.
- Skips `hydrateFromDisk` — the detached window does not restore the previous
  session.
- Does not subscribe to the persistence scheduler — detached windows must not
  overwrite the main window's `state.json`.

### Closing a detached window

When the user closes a detached window (native close button), the Rust
`on_window_event` handler emits `detached-window-closed`. The main window
listens for this event via:

```ts
listen<{ path: string }>('detached-window-closed', (e) => {
  useStore.getState().handleDetachedClosed(e.payload.path);
});
```

`handleDetachedClosed(path)` in the store:

1. Calls `invoke('unwatch', { path })` to release the file-watcher reference
   that the detached window's `openFile` call acquired.
2. If the document is already open in the main window, does nothing further.
3. If the document is not open in the main window, and is not already in
   `recentlyClosed`, adds a `RecentEntry` (using `stemName(path)` as the
   title) to the front of `recentlyClosed`, capped at 20 entries.
