#!/usr/bin/env bash
set -euo pipefail

# Normalize CI=1/0 → true/false so cargo-tauri doesn't reject the value
case "${CI:-}" in
  1|true)  export CI=true  ;;
  0|false) export CI=false ;;
  *)       unset CI        ;;
esac

# Compile-only first to surface release-profile errors fast
cargo tauri build --no-bundle

# Bundle .app only (no DMG yet) — we need to patch the .app before DMG-ing
cargo tauri build --bundles app

APP_DIR="src-tauri/target/release/bundle/macos/PeekMD.app"
APP_MACOS="$APP_DIR/Contents/MacOS"

# Copy the peekmd-cli helper binary into the app bundle so the skill can find it
# at a stable path. Tauri only bundles the primary binary; extras need manual placement.
cp "src-tauri/target/release/peekmd-cli" "$APP_MACOS/peekmd-cli"
chmod +x "$APP_MACOS/peekmd-cli"

# Drop stray build helpers Cargo leaks into target/release that get picked up.
rm -f "$APP_MACOS/gen_syntect_css"

# Now build the DMG with the patched .app
cargo tauri build --bundles dmg

DMG=$(ls -t src-tauri/target/release/bundle/dmg/PeekMD_*.dmg 2>/dev/null | head -1 || true)

echo
echo "✓ Built (unsigned): $APP_DIR"
[ -n "$DMG" ] && echo "✓ DMG: $DMG"
echo
echo "First-run notes for users:"
echo "  • macOS will block the .app on first launch (\"unidentified developer\")."
echo "  • Right-click PeekMD.app → Open → Open, OR run:"
echo "      xattr -dr com.apple.quarantine /Applications/PeekMD.app"
