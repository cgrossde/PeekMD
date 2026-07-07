use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use crate::watcher::WatcherState;

/// Shared state holding the path of the document that was right-clicked.
/// Set immediately before popping the context menu; read by the global
/// on_menu_event handler registered once at app setup.
#[derive(Default)]
pub struct ContextMenuTarget(Mutex<Option<String>>);

impl ContextMenuTarget {
    pub fn set(&self, path: String) {
        *self.0.lock().unwrap() = Some(path);
    }
    /// Take the current target, clearing it so stale events from lingering
    /// menu interactions don't fire against the wrong path.
    pub fn get(&self) -> Option<String> {
        self.0.lock().unwrap().clone()
    }
}

#[tauri::command]
pub fn watch_paths(
    app: AppHandle,
    state: State<'_, WatcherState>,
    paths: Vec<PathBuf>,
) -> Result<(), String> {
    state.watch(&app, paths)
}

#[tauri::command]
pub fn unwatch(
    state: State<'_, WatcherState>,
    path: PathBuf,
) -> Result<(), String> {
    state.unwatch(&path)
}

#[tauri::command]
pub fn watch_images(
    app: AppHandle,
    state: State<'_, WatcherState>,
    md: PathBuf,
    images: Vec<PathBuf>,
) -> Result<(), String> {
    state.watch_images(&app, md, images)
}

#[tauri::command]
pub fn unwatch_images(
    state: State<'_, WatcherState>,
    md: PathBuf,
) -> Result<(), String> {
    state.unwatch_images(&md);
    Ok(())
}

#[tauri::command]
pub fn reveal_in_finder(app: AppHandle, path: PathBuf) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_html(app: AppHandle, html: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_html(&html, Some(&html)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resolve_md_link(base: PathBuf, href: String) -> Option<PathBuf> {
    // Strip file:// prefix
    let href = href.strip_prefix("file://").unwrap_or(&href);
    // Strip URL fragments
    let href = href.split('#').next().unwrap_or("");
    if href.is_empty() { return None; }

    let resolved = if std::path::Path::new(href).is_absolute() {
        PathBuf::from(href)
    } else {
        let parent = base.parent()?.to_path_buf();
        parent.join(href)
    };

    let canonical = std::fs::canonicalize(&resolved).ok()?;
    let ext = canonical.extension()?.to_str()?.to_ascii_lowercase();
    if !matches!(ext.as_str(), "md" | "markdown" | "mdown" | "mkd") {
        return None;
    }
    if canonical.exists() { Some(canonical) } else { None }
}

#[tauri::command]
pub fn show_sidebar_context_menu(
    app: AppHandle,
    target: State<'_, ContextMenuTarget>,
    path: String,
    _x: f64,
    _y: f64,
) -> Result<(), String> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, ContextMenu};
    let win = app.get_webview_window("main").ok_or("no main window")?;
    let reveal     = MenuItemBuilder::with_id("reveal",       "Reveal in Finder").build(&app).map_err(|e| e.to_string())?;
    let copy_path  = MenuItemBuilder::with_id("copy_path",    "Copy Path"       ).build(&app).map_err(|e| e.to_string())?;
    let copy_html  = MenuItemBuilder::with_id("copy_html",    "Copy as HTML"    ).build(&app).map_err(|e| e.to_string())?;
    let close      = MenuItemBuilder::with_id("close",        "Close"           ).build(&app).map_err(|e| e.to_string())?;
    let close_others = MenuItemBuilder::with_id("close_others", "Close Others"  ).build(&app).map_err(|e| e.to_string())?;
    let menu = MenuBuilder::new(&app)
        .item(&reveal)
        .item(&copy_path)
        .item(&copy_html)
        .separator()
        .item(&close)
        .item(&close_others)
        .build()
        .map_err(|e| e.to_string())?;
    // Set the target path before popup so the global on_menu_event handler
    // (registered once in lib.rs::setup) can read it without accumulating closures.
    target.set(path);
    menu.popup(win.as_ref().window().clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn spawn_detached_window(
    app: AppHandle,
    path: String,
    screen_x: f64,
    screen_y: f64,
) -> Result<(), String> {
    let label = format!("doc-{}", uuid::Uuid::new_v4().simple());
    let basename = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Untitled");
    let encoded_path = urlencoding::encode(&path).into_owned();
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(format!("index.html?detached={}", encoded_path).into()),
    )
    .title(format!("PeekMD — {}", basename))
    .inner_size(640.0, 420.0)
    .position(screen_x, screen_y)
    .min_inner_size(480.0, 320.0)
    .build()
    .map_err(|e| e.to_string())?;

    // The detached window's own `watch_paths` call (made when it opens
    // `path` on load) holds a reference on the shared file watcher that
    // nothing releases if the window is closed with the native close button
    // instead of through the app's own `close()` action. Emit an event the
    // main window can react to — releasing that watch reference and, if the
    // doc wasn't open there either, restoring it to Recently Closed.
    let detached_path = path.clone();
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let _ = handle.emit(
                "detached-window-closed",
                serde_json::json!({ "path": detached_path }),
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub fn backup_state_file(app: AppHandle) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    let state_path = config_dir.join("state.json");
    let bak_path = config_dir.join("state.json.bak");
    if state_path.exists() {
        std::fs::copy(&state_path, &bak_path).map_err(|e| e.to_string())?;
        std::fs::remove_file(&state_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a fresh temp dir with `a.md` and `b.txt` inside it, returning
    /// the dir path. Each test gets its own dir (keyed by test name) so
    /// parallel `cargo test` runs don't race on the same files.
    fn fixture_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("peekmd-resolve-link-test-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.md"), "# A").unwrap();
        std::fs::write(dir.join("b.txt"), "not markdown").unwrap();
        // `resolve_md_link` canonicalizes its result (e.g. resolving macOS's
        // /tmp -> /private/tmp symlink), so the fixture dir must be
        // canonicalized too for expected-path comparisons to match.
        dir.canonicalize().unwrap()
    }

    #[test]
    fn resolve_md_link_resolves_relative_sibling() {
        let dir = fixture_dir("relative");
        let base = dir.join("a.md");

        let resolved = resolve_md_link(base, "a.md".to_string());

        assert_eq!(resolved, Some(dir.join("a.md")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_md_link_rejects_non_markdown_targets() {
        let dir = fixture_dir("non-md");
        let base = dir.join("a.md");

        let resolved = resolve_md_link(base, "b.txt".to_string());

        assert_eq!(resolved, None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_md_link_rejects_missing_files() {
        let dir = fixture_dir("missing");
        let base = dir.join("a.md");

        let resolved = resolve_md_link(base, "does-not-exist.md".to_string());

        assert_eq!(resolved, None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_md_link_strips_file_prefix_and_fragment() {
        let dir = fixture_dir("prefix-fragment");
        let base = dir.join("a.md");
        let href = format!("file://{}#section-1", dir.join("a.md").display());

        let resolved = resolve_md_link(base, href);

        assert_eq!(resolved, Some(dir.join("a.md")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_md_link_returns_none_for_empty_href() {
        let dir = fixture_dir("empty");
        let base = dir.join("a.md");

        assert_eq!(resolve_md_link(base, "#just-a-fragment".to_string()), None);

        std::fs::remove_dir_all(&dir).ok();
    }
}
