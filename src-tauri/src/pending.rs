use std::path::PathBuf;
use parking_lot::Mutex;

pub struct PendingPaths(Mutex<Vec<PathBuf>>);

impl PendingPaths {
    pub fn new(initial: Vec<PathBuf>) -> Self {
        Self(Mutex::new(initial))
    }

    pub fn drain(&self) -> Vec<PathBuf> {
        std::mem::take(&mut *self.0.lock())
    }

    pub fn peek(&self) -> Vec<PathBuf> {
        self.0.lock().clone()
    }

    pub fn extend(&self, paths: Vec<PathBuf>) {
        self.0.lock().extend(paths);
    }
}
