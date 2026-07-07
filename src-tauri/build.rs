fn main() {
    // capabilities/debug.json grants the debug-only automation-socket
    // permission (tauri-plugin-playwright, only ever *registered* in
    // lib.rs behind `#[cfg(debug_assertions)]`). Only fold that capability
    // into the app's ACL when Cargo's `DEBUG` build-script env var is
    // "true" — the exact same "does this build have debug assertions
    // enabled" signal `cfg(debug_assertions)` uses at compile time. This
    // keeps the permission and the plugin registration in lock-step: a
    // release build's manifest never grants the automation socket, even
    // if the `cfg(debug_assertions)` gate on the plugin were ever
    // accidentally dropped from lib.rs.
    println!("cargo:rerun-if-changed=capabilities");
    let debug_assertions = std::env::var("DEBUG").map(|v| v == "true").unwrap_or(false);
    let capabilities_path_pattern: &'static str = if debug_assertions {
        "capabilities/*.json"
    } else {
        "capabilities/default.json"
    };

    let attributes =
        tauri_build::Attributes::new().capabilities_path_pattern(capabilities_path_pattern);
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
