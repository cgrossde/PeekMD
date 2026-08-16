//! macOS default-application registration for Markdown files.
//!
//! `setDefaultApplicationAtURL:toOpenContentType:` does NOT prompt — macOS only
//! shows a confirmation sheet for URL-scheme defaults (default browser/mail).
//! Content-type defaults change silently and immediately. Calling it unconditionally
//! would seize the association from whatever the user actually chose, on every
//! launch, with no way for them to object.
//!
//! So the consent step is ours: ask with our own dialog, and only call the API on
//! an explicit yes. Declining is recorded and never asked again.
//!
//! The UTI below is the shared, system-recognised Markdown type — Xcode and Notes
//! declare it as an Apple-internal type, and Marked/OmniFocus/Notebooks target it
//! too. `tauri.conf.json` binds our file association to the same identifier via
//! `contentTypes`, so all Markdown viewers compete for one type rather than each
//! owning a private one.

use block2::RcBlock;
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{NSBundle, NSError, NSString};
use objc2_uniform_type_identifiers::UTType;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const MARKDOWN_UTI: &str = "net.daringfireball.markdown";

/// Sentinel recording that the user has already been asked. Written whatever the
/// answer is — declining must not re-prompt on every launch.
const MARKER: &str = "default-app-prompted";

fn markdown_type() -> Option<objc2::rc::Retained<UTType>> {
    UTType::typeWithIdentifier(&NSString::from_str(MARKDOWN_UTI))
}

fn bundle_path() -> Option<String> {
    let url = NSBundle::mainBundle().bundleURL();
    url.path().map(|p| p.to_string())
}

/// Whether PeekMD is already the registered handler for Markdown.
pub fn is_default_handler() -> bool {
    let Some(ty) = markdown_type() else {
        return false;
    };
    let Some(ours) = bundle_path() else {
        return false;
    };
    NSWorkspace::sharedWorkspace()
        .URLForApplicationToOpenContentType(&ty)
        .and_then(|url| url.path())
        .is_some_and(|current| current.to_string() == ours)
}

/// Make PeekMD the default Markdown handler. This applies immediately and without
/// any system confirmation, so only call it once the user has agreed.
///
/// Must run on the main thread — AppKit requirement.
pub fn request_default_handler() {
    let Some(ty) = markdown_type() else {
        tracing::warn!("unknown UTI {MARKDOWN_UTI}; skipping default-handler request");
        return;
    };
    let url = NSBundle::mainBundle().bundleURL();

    let completion = RcBlock::new(|err: *mut NSError| {
        if err.is_null() {
            tracing::info!("PeekMD is now the default Markdown handler");
        } else {
            let msg = unsafe { &*err }.localizedDescription();
            tracing::warn!("failed to set default Markdown handler: {msg}");
        }
    });

    NSWorkspace::sharedWorkspace().setDefaultApplicationAtURL_toOpenContentType_completionHandler(
        &url,
        &ty,
        Some(&completion),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_uti_is_known_to_the_system() {
        // Guards the tauri.conf.json `contentTypes` entry: if this identifier ever
        // stops resolving, the file association silently binds to nothing.
        let ty = markdown_type().expect("net.daringfireball.markdown should resolve");
        assert_eq!(ty.identifier().to_string(), MARKDOWN_UTI);
    }

    #[test]
    fn markdown_uti_claims_the_md_extension() {
        let ty = markdown_type().unwrap();
        let md = UTType::typeWithFilenameExtension(&NSString::from_str("md"))
            .expect("`md` should map to a type");
        assert!(md.conformsToType(&ty) || md.identifier() == ty.identifier());
    }

    #[test]
    fn is_default_handler_is_false_for_the_test_binary() {
        // Mostly a smoke test that the AppKit calls don't trap.
        assert!(!is_default_handler());
    }
}

fn marker_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(MARKER))
}

/// Ask once, on the first launch that finds us not already the default.
///
/// "Not Now" is remembered permanently — re-asking would defeat the point, since
/// the API itself offers the user no way to refuse.
///
/// Skipped in debug builds: a dev bundle lives in `target/debug` and must never
/// become the system-wide handler. Set `PEEKMD_DEFAULT_APP_PROMPT=1` to test it.
pub fn maybe_prompt_on_first_launch(app: &AppHandle) {
    let forced = std::env::var_os("PEEKMD_DEFAULT_APP_PROMPT").is_some();
    if cfg!(debug_assertions) && !forced {
        return;
    }

    let Some(marker) = marker_path(app) else {
        return;
    };
    if marker.exists() {
        return;
    }

    // Record the attempt before asking, so a crash or a decline still counts.
    if let Some(parent) = marker.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&marker, "").ok();

    let handle = app.clone();
    std::thread::spawn(move || {
        // Let the window draw before a modal dialog appears over it.
        std::thread::sleep(std::time::Duration::from_millis(1500));

        // Reading the current handler goes through LaunchServices, which is safe
        // off the main thread; the mutating call below is not.
        if is_default_handler() {
            return;
        }

        // blocking_show must not run on the main thread — it would deadlock the
        // event loop it needs to pump. This background thread is the right place.
        let accepted = handle
            .dialog()
            .message("Open Markdown files with PeekMD by default?")
            .title("Set PeekMD as Default")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Use PeekMD".to_owned(),
                "Not Now".to_owned(),
            ))
            .blocking_show();

        if !accepted {
            tracing::info!("user declined default Markdown handler");
            return;
        }

        handle.run_on_main_thread(request_default_handler).ok();
    });
}
