# IPC

PeekMD exposes a set of Tauri commands (frontend → Rust) and emits a set of events (Rust → frontend or Rust → frontend via menu event loop). This document covers the full surface, the capabilities that permit it, and implementation notes.

## Commands

All commands are registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![]` and implemented in `src-tauri/src/render.rs` and `src-tauri/src/commands.rs`.

Frontend invocations use `invoke` from `@tauri-apps/api/core`.

| Command | Parameters | Return type | Description |
| --- | --- | --- | --- |
| `render_markdown` | `path: PathBuf` | `Result<RenderedDoc, RenderError>` | Read file, run comrak, extract headings, stat mtime. Rejects non-Markdown extensions. |
| `take_pending_paths` | — | `Vec<PathBuf>` | Drain the `PendingPaths` state (CLI args / macOS Open With) collected before the webview loaded. Called once on mount as a fallback to the `peekmd://open-files` event. |
| `watch_paths` | `paths: Vec<PathBuf>` | `Result<(), String>` | Register paths with `WatcherState`. Watches each path's parent directory with `NonRecursive` mode. |
| `unwatch` | `path: PathBuf` | `Result<(), String>` | Unregister a path from `WatcherState`. Unwatches the parent directory when ref count reaches zero. |
| `watch_images` | `md: PathBuf, images: Vec<PathBuf>` | `Result<(), String>` | Register local images referenced by a Markdown doc. When any image changes on disk a `file-changed` event is emitted for the owning `md` path, triggering a re-render so the new image bytes are picked up. |
| `unwatch_images` | `md: PathBuf` | `Result<(), String>` | Unregister all images associated with a Markdown doc. Called on close. |
| `reveal_in_finder` | `path: PathBuf` | `Result<(), String>` | Calls `tauri-plugin-opener`'s `reveal_item_in_dir`. |
| `copy_path` | `path: String` | `Result<(), String>` | Writes plain text to clipboard via `tauri-plugin-clipboard-manager`. |
| `copy_html` | `html: String` | `Result<(), String>` | Writes HTML to clipboard. Uses `ClipboardExt::write_html(&html, Some(&html))` — both the HTML representation and the plain-text fallback are set to the same string. |
| `resolve_md_link` | `base: PathBuf, href: String` | `Option<PathBuf>` | Resolve a relative or absolute `.md` link against `base`. Strips `file://` prefix and URL fragments. Returns `None` for non-Markdown targets or paths that do not exist. |
| `show_sidebar_context_menu` | `path: String, _x: f64, _y: f64` | `Result<(), String>` | Pops a native context menu. Stores `path` in `ContextMenuTarget` before calling `menu.popup()`. Menu selections are delivered via the `sidebar-menu-click` event. |
| `spawn_detached_window` | `path: String, screen_x: f64, screen_y: f64` | `Result<(), String>` | Spawns a new Tauri window (`doc-<uuid>`) showing a single document with the sidebar hidden. Positioned near the given screen coordinates. Used when a sidebar row is dragged outside the app window bounds. |
| `backup_state_file` | — | `Result<(), String>` | Copies `state.json` to `state.json.bak` and removes the original. Called by `loadState` in `persistence.ts` when the stored schema version does not match `CURRENT_VERSION`. |
| `skill_install_status` | — | `SkillStatus` | Detects installed AI coding agents (`claude`, `omp`, `opencode`) by probing `PATH` and known fallback install paths. Returns `{ agent_detected: bool, skill_installed: bool, agents: [{ name, binary }] }`. Does not require the app to be running. |
| `install_agent_skill` | — | `Result<String, String>` | Symlinks the bundled `skills/peekmd/` directory into `~/.claude/skills/peekmd` and `~/.claude/skills/marked`. Returns a success message or an error string. Idempotent — replaces stale symlinks. |

### RenderedDoc shape

```rust
pub struct RenderedDoc {
    pub html: String,
    pub title: String,
    pub path: String,
    pub headings: Vec<Heading>,
    pub mtime: u64,
}

pub struct Heading {
    pub id: String,   // e.g. "peekmd-overview"
    pub level: u8,
    pub text: String, // plain text, HTML stripped
}
```

### copy_html note

`tauri-plugin-clipboard-manager`'s `write_html` on macOS writes both the `public.html` and `public.utf8-plain-text` pasteboard types. The `html` argument is used for both. If a caller needs the clipboard to carry styled HTML that differs from the plain-text fallback, the frontend can use `navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], {type:'text/html'}), 'text/plain': new Blob([text], {type:'text/plain'}) })])` directly. The Rust command covers the common case (paste HTML into a text editor).

## Events

| Event | Direction | Payload | Emitter | Consumer |
| --- | --- | --- | --- | --- |
| `file-changed` | Rust → frontend | `{ path: string, mtime: number }` | `WatcherState` callback in `watcher.rs` | `src/lib/watcher.ts` → `store.markDirty` |
| `file-removed` | Rust → frontend | `{ path: string }` | `WatcherState` callback in `watcher.rs` | `src/lib/watcher.ts` → `store.markRemoved` |
| `peekmd://open-files` | Rust → frontend | `{ paths: string[] }` | `lib.rs` setup + `RunEvent::Opened` handler | `App.tsx` `useEffect` on mount |
| `sidebar-menu-click` | Rust → frontend | `{ action: string, path: string }` | `on_menu_event` in `lib.rs` setup | `Sidebar.tsx` `useEffect` listener |

### sidebar-menu-click action values

| `action` | Effect in Sidebar.tsx |
| --- | --- |
| `reveal` | `invoke('reveal_in_finder', { path })` |
| `copy_path` | `invoke('copy_path', { path })` |
| `copy_html` | `invoke('copy_html', { html: doc.html })` |
| `close` | `store.close(path)` |
| `close_others` | `store.closeOthers(path)` |

### show_sidebar_context_menu: ContextMenuTarget

`show_sidebar_context_menu` stores the right-clicked path in the `ContextMenuTarget` managed state before calling `popup()`. The global `on_menu_event` handler registered once in `lib.rs::setup` reads it back:

```rust
app.on_menu_event(|app, event| {
    let target = app.state::<commands::ContextMenuTarget>();
    if let Some(path) = target.get() {
        let action = event.id().as_ref().to_string();
        let _ = app.emit("sidebar-menu-click",
            serde_json::json!({ "action": action, "path": path }));
    }
});
```

This indirection is necessary because `popup()` requires a `Window` handle obtained via `app.get_webview_window("main")`, and Tauri's menu event callback does not carry per-item closure state.

## Capabilities

Capabilities are declared in `src-tauri/capabilities/default.json` and apply to the `main` window.

| Permission | What it unlocks |
| --- | --- |
| `core:default` | Core IPC, window management, event emit/listen |
| `core:event:default` | `emit` / `listen` for custom events |
| `dialog:default` + `dialog:allow-open` | File open dialog (`⌘O`) via `tauri-plugin-dialog` |
| `opener:default` + `opener:allow-reveal-item-in-dir` | Reveal in Finder via `tauri-plugin-opener` |
| `window-state:default` | Persist and restore window bounds via `tauri-plugin-window-state` |
| `store:default` | Read/write `state.json` via `tauri-plugin-store` |
| `clipboard-manager:allow-write-text` | `copy_path` command (plain text) |
| `clipboard-manager:allow-write-html` | `copy_html` command (HTML + plain text) |
| `playwright:default` | Debug-only automation socket (compiled in always; only initialised in `#[cfg(debug_assertions)]` builds) |

There is no `fs:*` permission and `tauri-plugin-fs` is not registered — every file read goes through `render_markdown`'s `std::fs::read_to_string`, not the generic `fs` plugin, so granting the webview a filesystem-scoped capability bought nothing and was removed. There is likewise no `core:window:allow-set-title` — nothing calls `WebviewWindow::set_title`; the window title is always "PeekMD".

## Content Security Policy and the asset protocol

`tauri.conf.json`'s `app.security.csp` is a real policy (it used to be `null`, disabling CSP entirely):

```json
"csp": {
  "default-src": "'self'",
  "script-src": "'self'",
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self' asset: http://asset.localhost data:",
  "font-src": "'self'",
  "connect-src": "ipc: http://ipc.localhost"
}
```

`script-src: 'self'` with no `'unsafe-inline'` blocks inline `<script>` tags and inline event-handler attributes (`onerror=`, `onload=`, ...) at the WebView level. This matters because `render.unsafe = true` (see [rendering.md](rendering.md#unsafe--tagfilter)) allows raw HTML through comrak's `tagfilter`, which only blocklists tag names, not attributes — the CSP is the actual backstop for that residual injection vector. `style-src` needs `'unsafe-inline'` because React writes some inline `style` attributes directly (e.g. icon spacing in `Sidebar.tsx`).

`app.security.assetProtocol` is enabled with `scope: ["$HOME/**/*"]` so `convertFileSrc` can serve local image files referenced by rendered Markdown — see [rendering.md](rendering.md#images) for how `src/lib/mdImages.ts` uses it.

### Unstable feature note

`show_sidebar_context_menu` calls `app.get_webview_window("main")` to obtain the window handle for `popup()`. This is a stable Tauri 2 API (`Manager::get_webview_window`), not an unstable private API. The `popup(win.as_ref().window().clone())` call dereferences the `WebviewWindow` to its underlying `Window` — a supported pattern in Tauri 2.

Drag-out-to-new-window is implemented via `spawn_detached_window`. It requires no `macos-private-api`. Outside-bounds detection uses standard `screenX`/`screenY` values read from the drag event in the frontend; when those coordinates fall outside the app window the command is invoked to open a new detached window at that position.
