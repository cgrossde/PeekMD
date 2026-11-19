fn main() {
    // capabilities/debug.json grants the debug-only automation-socket
    // permission (tauri-plugin-playwright, only ever *registered* in
    // lib.rs behind `#[cfg(debug_assertions)]`). Only fold that capability
    // into the app's ACL when Cargo sets `CARGO_CFG_DEBUG_ASSERTIONS` —
    // the build-script view of the same `cfg(debug_assertions)` lib.rs
    // uses. (Cargo's `DEBUG` var is the *debuginfo* setting, not debug
    // assertions: `debug = true` in a release profile would have leaked
    // the automation socket into release builds.) This keeps the
    // permission and the plugin registration in lock-step: a release
    // build's manifest never grants the automation socket, even if the
    // `cfg(debug_assertions)` gate on the plugin were ever accidentally
    // dropped from lib.rs.
    println!("cargo:rerun-if-changed=capabilities");
    let debug_assertions = std::env::var_os("CARGO_CFG_DEBUG_ASSERTIONS").is_some();
    let capabilities_path_pattern: &'static str = if debug_assertions {
        "capabilities/*.json"
    } else {
        "capabilities/default.json"
    };

    let attributes =
        tauri_build::Attributes::new().capabilities_path_pattern(capabilities_path_pattern);
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
