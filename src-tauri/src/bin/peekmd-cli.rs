/// peekmd-cli — headless helper for the PeekMD Tauri app.
///
/// Subcommands:
///   list                 Print open docs, active doc, and recently-closed docs as JSON.
///   open <path...>       Open one or more Markdown files in PeekMD (no focus steal).
///
/// Exit codes: 0 = ok, 1 = error.
use std::{path::PathBuf, process};

fn main() {
    let mut args = std::env::args().skip(1).peekable();
    match args.next().as_deref() {
        Some("list") => cmd_list(),
        Some("open") => {
            let paths: Vec<String> = args.collect();
            if paths.is_empty() {
                eprintln!("peekmd-cli open: no paths given");
                process::exit(1);
            }
            cmd_open(paths);
        }
        Some(other) => {
            eprintln!("peekmd-cli: unknown subcommand '{other}'");
            eprintln!("Usage: peekmd-cli list | open <path...>");
            process::exit(1);
        }
        None => {
            eprintln!("Usage: peekmd-cli list | open <path...>");
            process::exit(1);
        }
    }
}

// ---------------------------------------------------------------------------
// list — read state.json and print as JSON
// ---------------------------------------------------------------------------

fn state_path() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("com.peekmd.desktop").join("state.json"))
}

fn cmd_list() {
    let path = match state_path() {
        Some(p) => p,
        None => {
            eprintln!("peekmd-cli list: cannot determine data dir");
            process::exit(1);
        }
    };

    if !path.exists() {
        // App has never run — return empty state so callers don't have to special-case.
        println!("{{\"openDocs\":[],\"activeDoc\":null,\"recentlyClosed\":[]}}");
        return;
    }

    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("peekmd-cli list: read {}: {e}", path.display());
            process::exit(1);
        }
    };

    let v: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("peekmd-cli list: parse error: {e}");
            process::exit(1);
        }
    };

    // Emit only the fields an agent cares about.
    let out = serde_json::json!({
        "openDocs":      v.get("openDocs").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        "activeDoc":     v.get("activeDoc").cloned().unwrap_or(serde_json::Value::Null),
        "recentlyClosed": v.get("recentlyClosed").cloned().unwrap_or(serde_json::Value::Array(vec![])),
    });

    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}

// ---------------------------------------------------------------------------
// open — launch PeekMD with files, no focus steal
// ---------------------------------------------------------------------------

fn cmd_open(paths: Vec<String>) {
    // Resolve each path to absolute so PeekMD receives unambiguous file:// URLs.
    let abs: Vec<PathBuf> = paths
        .iter()
        .map(|p| {
            let pb = PathBuf::from(p);
            if pb.is_absolute() {
                pb
            } else {
                std::env::current_dir()
                    .unwrap_or_default()
                    .join(pb)
            }
        })
        .collect();

    // Strategy 1: `open -g -b com.peekmd.desktop --args <paths>`
    // -g = do not bring the app to the foreground.
    // Works when the signed .app is installed under /Applications.
    let mut cmd = std::process::Command::new("open");
    cmd.arg("-g")
        .arg("-b")
        .arg("com.peekmd.desktop");
    // Pass --args before the file paths so macOS routes them to the app's argv.
    cmd.arg("--args");
    for p in &abs {
        cmd.arg(p);
    }

    match cmd.status() {
        Ok(s) if s.success() => return,
        _ => {}
    }

    // Strategy 2: directly exec the dev-build binary (skips the bundle launcher).
    // This binary lives next to peekmd-cli in the same `target/…/MacOS/` directory.
    let self_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from));

    if let Some(dir) = self_dir {
        // Inside the .app bundle: Contents/MacOS/peekmd-cli → Contents/MacOS/PeekMD
        // In dev target dir: target/release/peekmd-cli → target/release/peekmd
        for name in &["PeekMD", "peekmd"] {
            let bin = dir.join(name);
            if bin.exists() {
                let mut c = std::process::Command::new(&bin);
                for p in &abs {
                    c.arg(p);
                }
                match c.spawn() {
                    Ok(_) => return,
                    Err(e) => eprintln!("peekmd-cli open: spawn {}: {e}", bin.display()),
                }
            }
        }
    }

    eprintln!("peekmd-cli open: could not locate PeekMD binary. Is it installed at /Applications/PeekMD.app?");
    process::exit(1);
}
