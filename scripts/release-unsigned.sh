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

# Bundle without signing — bundler skips signing when no identity/cert env is present
cargo tauri build

APP="src-tauri/target/release/bundle/macos/PeekMD.app"
DMG=$(ls -t src-tauri/target/release/bundle/dmg/PeekMD_*.dmg 2>/dev/null | head -1 || true)

echo
echo "✓ Built (unsigned): $APP"
[ -n "$DMG" ] && echo "✓ DMG: $DMG"
echo
echo "First-run notes for users:"
echo "  • macOS will block the .app on first launch (\"unidentified developer\")."
echo "  • Right-click PeekMD.app → Open → Open, OR run:"
echo "      xattr -dr com.apple.quarantine /Applications/PeekMD.app"
