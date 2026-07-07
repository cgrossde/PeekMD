#!/usr/bin/env bash
set -euo pipefail

# Normalize CI=1/0 → true/false so cargo-tauri doesn't reject the value
case "${CI:-}" in
  1|true)  export CI=true  ;;
  0|false) export CI=false ;;
  *)       unset CI        ;;
esac

# Validate signing + notarization env up front
: "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY not set (Developer ID Application cert name)}"
: "${APPLE_ID:?APPLE_ID not set (Apple ID email)}"
: "${APPLE_PASSWORD:?APPLE_PASSWORD not set (app-specific password)}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID not set}"

# Compile-only first to surface release-profile errors fast
cargo tauri build --no-bundle

# Bundle .app only (no DMG yet) — we need to patch the .app before DMG-ing
# hardenedRuntime enabled so the codesign step below can notarize correctly
cargo tauri build --bundles app --config '{"bundle":{"macOS":{"hardenedRuntime":true}}}'

APP_DIR="src-tauri/target/release/bundle/macos/PeekMD.app"
APP_MACOS="$APP_DIR/Contents/MacOS"

# Copy the peekmd-cli helper binary into the app bundle.
# Tauri only bundles the primary binary; extras need manual placement.
# codesign below will re-sign the whole bundle including this binary.
cp "src-tauri/target/release/peekmd-cli" "$APP_MACOS/peekmd-cli"
chmod +x "$APP_MACOS/peekmd-cli"

# Drop stray build helpers Cargo leaks into target/release that get picked up.
rm -f "$APP_MACOS/gen_syntect_css"

# Now build the signed + notarized DMG with the patched .app
cargo tauri build --bundles dmg --config '{"bundle":{"macOS":{"hardenedRuntime":true}}}'

DMG=$(ls -t src-tauri/target/release/bundle/dmg/PeekMD_*.dmg | head -1)

codesign --verify --deep --strict --verbose=2 "$APP_DIR"
xcrun stapler validate "$DMG"

echo
echo "✓ Signed + notarized: $DMG"
