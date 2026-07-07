mod render;
mod pending;
mod logging;
mod watcher;
mod commands;
mod skill;

use std::path::PathBuf;
use tauri::{Emitter, Manager, RunEvent};
use pending::PendingPaths;

#[derive(serde::Serialize, Clone)]
struct OpenFilesPayload {
    paths: Vec<PathBuf>,
}

#[tauri::command]
fn take_pending_paths(state: tauri::State<'_, PendingPaths>) -> Vec<PathBuf> {
    state.drain()
}


pub fn run() {
    logging::init();

    // CLI-arg-passed files (macOS "open -a PeekMD file.md", or `peekmd file.md`)
    let mut initial: Vec<PathBuf> = Vec::new();
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        if let Ok(url) = url::Url::parse(&arg) {
            if let Ok(p) = url.to_file_path() {
                initial.push(p);
                continue;
            }
        }
        initial.push(PathBuf::from(arg));
    }
    let pending = PendingPaths::new(initial);

    #[cfg(debug_assertions)]
    fn debug_plugins() -> impl tauri::plugin::Plugin<tauri::Wry> {
        tauri_plugin_playwright::init()
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(debug_plugins());

    let app = builder
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(pending)
        .manage(watcher::WatcherState::new())
        .manage(commands::ContextMenuTarget::default())
        .invoke_handler(tauri::generate_handler![
            render::render_markdown,
            take_pending_paths,
            commands::watch_paths,
            commands::unwatch,
            commands::watch_images,
            commands::unwatch_images,
            commands::reveal_in_finder,
            commands::copy_html,
            commands::copy_path,
            commands::resolve_md_link,
            commands::show_sidebar_context_menu,
            commands::spawn_detached_window,
            commands::backup_state_file,
            skill::skill_install_status,
            skill::install_agent_skill,
        ])
        .setup(|app| {
            // Emit any pending initial paths to the frontend after it attaches.
            // The frontend also calls `take_pending_paths` on mount as a fallback.
            let handle = app.handle().clone();
            let paths = handle.state::<PendingPaths>().peek();
            if !paths.is_empty() {
                let _ = handle.emit("peekmd://open-files", OpenFilesPayload { paths });
            }
            // Register the sidebar context-menu event handler exactly once.
            // show_sidebar_context_menu sets the current path in ContextMenuTarget
            // before popping the menu; this handler reads it back.
            app.on_menu_event(|app, event| {
                use tauri::Emitter;
                let target = app.state::<commands::ContextMenuTarget>();
                if let Some(path) = target.get() {
                    let action = event.id().as_ref().to_string();
                    let _ = app.emit("sidebar-menu-click",
                        serde_json::json!({ "action": action, "path": path }));
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build tauri app");

    app.run(|app_handle, event| {
        // macOS "Open With" and Finder double-click deliver here.
        if let RunEvent::Opened { urls } = event {
            let paths: Vec<PathBuf> = urls
                .into_iter()
                .filter_map(|u| u.to_file_path().ok())
                .collect();
            if !paths.is_empty() {
                app_handle.state::<PendingPaths>().extend(paths.clone());
                let _ = app_handle
                    .emit("peekmd://open-files", OpenFilesPayload { paths });
            }
        }
    });
}
