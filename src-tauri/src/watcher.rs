use std::{collections::HashMap, path::{Path, PathBuf}, sync::Arc, time::Duration};
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer, DebouncedEventKind};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

pub struct WatcherState {
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    debouncer: Option<Debouncer<notify::RecommendedWatcher>>,
    watched_files: HashMap<PathBuf, usize>,
    watched_dirs: HashMap<PathBuf, usize>,
    /// Maps image path → the md document that references it.
    /// When an image changes, we emit file-changed for the md path instead.
    image_to_md: HashMap<PathBuf, PathBuf>,
}

#[derive(serde::Serialize, Clone)]
struct ChangePayload { path: String, mtime: u64 }
#[derive(serde::Serialize, Clone)]
struct RemovedPayload { path: String }

impl WatcherState {
    pub fn new() -> Self {
        Self { inner: Arc::new(Mutex::new(Inner {
            debouncer: None,
            watched_files: HashMap::new(),
            watched_dirs: HashMap::new(),
            image_to_md: HashMap::new(),
        })) }
    }

    pub fn watch(&self, app: &AppHandle, paths: Vec<PathBuf>) -> Result<(), String> {
        let mut inner = self.inner.lock();
        if inner.debouncer.is_none() {
            let handle = app.clone();
            let watched_ref = self.inner.clone();
            let d = new_debouncer(Duration::from_millis(100), move |res: DebounceEventResult| {
                if let Ok(events) = res {
                    let (watched_files, image_to_md): (std::collections::HashSet<PathBuf>, HashMap<PathBuf, PathBuf>) = {
                        let inner = watched_ref.lock();
                        (inner.watched_files.keys().cloned().collect(), inner.image_to_md.clone())
                    };
                    for ev in events {
                        // Image changed — emit file-changed for the owning md doc
                        if let Some(md_path) = image_to_md.get(&ev.path) {
                            if let Ok(md) = std::fs::metadata(md_path) {
                                if let Ok(m) = md.modified() {
                                    let secs = m.duration_since(std::time::UNIX_EPOCH)
                                        .map(|d| d.as_secs()).unwrap_or(0);
                                    let _ = handle.emit("file-changed", ChangePayload {
                                        path: md_path.to_string_lossy().into_owned(), mtime: secs,
                                    });
                                }
                            }
                            continue;
                        }
                        if !watched_files.contains(&ev.path) { continue; }
                        match ev.kind {
                            DebouncedEventKind::Any => {
                                if let Ok(md) = std::fs::metadata(&ev.path) {
                                    if let Ok(m) = md.modified() {
                                        let secs = m.duration_since(std::time::UNIX_EPOCH)
                                            .map(|d| d.as_secs()).unwrap_or(0);
                                        let _ = handle.emit("file-changed", ChangePayload {
                                            path: ev.path.to_string_lossy().into_owned(), mtime: secs,
                                        });
                                    }
                                } else {
                                    let _ = handle.emit("file-removed", RemovedPayload {
                                        path: ev.path.to_string_lossy().into_owned(),
                                    });
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }).map_err(|e| e.to_string())?;
            inner.debouncer = Some(d);
        }
        for p in paths {
            if inner.watched_files.contains_key(&p) {
                *inner.watched_files.get_mut(&p).unwrap() += 1;
                continue;
            }
            let parent = match p.parent() { Some(par) => par.to_path_buf(), None => continue };
            let is_new_dir = {
                let count = inner.watched_dirs.entry(parent.clone()).or_insert(0);
                let was_zero = *count == 0;
                *count += 1;
                was_zero
            };
            if is_new_dir {
                inner.debouncer.as_mut().unwrap().watcher()
                    .watch(&parent, RecursiveMode::NonRecursive)
                    .map_err(|e| e.to_string())?;
            }
            inner.watched_files.insert(p, 1);
        }
        Ok(())
    }

    pub fn unwatch(&self, path: &Path) -> Result<(), String> {
        let mut inner = self.inner.lock();
        let count = inner.watched_files.get_mut(path).map(|c| { *c -= 1; *c });
        match count {
            None => return Ok(()),
            Some(0) => { inner.watched_files.remove(path); }
            Some(_) => return Ok(()), // other windows still watching
        }
        if let Some(parent) = path.parent() {
            if let Some(count) = inner.watched_dirs.get_mut(parent) {
                *count -= 1;
                if *count == 0 {
                    inner.watched_dirs.remove(parent);
                    if let Some(d) = inner.debouncer.as_mut() {
                        let _ = d.watcher().unwatch(parent);
                    }
                }
            }
        }
        Ok(())
    }

    /// Register images referenced by a markdown document.
    /// Replaces any previous image set for this md path.
    pub fn watch_images(&self, app: &AppHandle, md: PathBuf, images: Vec<PathBuf>) -> Result<(), String> {
        // First remove stale entries for this md doc
        self.unwatch_images(&md);
        if images.is_empty() { return Ok(()); }
        let mut inner = self.inner.lock();
        // Ensure debouncer exists (watch() may not have been called yet, but
        // it will be — images are registered after the md file is opened).
        if inner.debouncer.is_none() {
            let handle = app.clone();
            let watched_ref = self.inner.clone();
            let d = new_debouncer(Duration::from_millis(100), move |res: DebounceEventResult| {
                // Minimal handler: full logic lives in the closure registered
                // in watch(). This path is only reached if somehow images are
                // watched before the md file — safe to ignore.
                let _ = (res, &handle, &watched_ref);
            }).map_err(|e| e.to_string())?;
            inner.debouncer = Some(d);
        }
        for img in images {
            inner.image_to_md.insert(img.clone(), md.clone());
            let parent = match img.parent() { Some(p) => p.to_path_buf(), None => continue };
            let is_new_dir = {
                let count = inner.watched_dirs.entry(parent.clone()).or_insert(0);
                let was_zero = *count == 0;
                *count += 1;
                was_zero
            };
            if is_new_dir {
                inner.debouncer.as_mut().unwrap().watcher()
                    .watch(&parent, RecursiveMode::NonRecursive)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// Remove all image watches registered for a markdown document.
    pub fn unwatch_images(&self, md: &Path) {
        let mut inner = self.inner.lock();
        let images: Vec<PathBuf> = inner.image_to_md.iter()
            .filter(|(_, v)| v.as_path() == md)
            .map(|(k, _)| k.clone())
            .collect();
        for img in images {
            inner.image_to_md.remove(&img);
            if let Some(parent) = img.parent() {
                if let Some(count) = inner.watched_dirs.get_mut(parent) {
                    *count -= 1;
                    if *count == 0 {
                        inner.watched_dirs.remove(parent);
                        if let Some(d) = inner.debouncer.as_mut() {
                            let _ = d.watcher().unwatch(parent);
                        }
                    }
                }
            }
        }
    }
}
