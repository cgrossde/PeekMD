#!/usr/bin/env bash
# Local, unsigned PeekMD DMG (for development). Releases use
# scripts/release-signed.sh, which is what CI runs.
#
# Tauri copies every enabled Cargo [[bin]] (including peekmd-cli) into
# Contents/MacOS/, so no post-build patching of the .app is needed.
# Set APPLE_SIGNING_IDENTITY=- to ad-hoc sign the .app for structure checks.
set -euo pipefail

# Normalize CI=1/0 → true/false so cargo-tauri doesn't reject the value
case "${CI:-}" in
  1|true)  export CI=true  ;;
  0|false) export CI=false ;;
  *)       unset CI        ;;
esac

# Compile-only first to surface release-profile errors fast
cargo tauri build --no-bundle

cargo tauri build --bundles app,dmg

APP_DIR="src-tauri/target/release/bundle/macos/PeekMD.app"
test -x "$APP_DIR/Contents/MacOS/peekmd-cli"

DMG=$(ls -t src-tauri/target/release/bundle/dmg/PeekMD_*.dmg 2>/dev/null | head -1 || true)

echo
echo "✓ Built (unsigned): $APP_DIR"
[ -n "$DMG" ] && echo "✓ DMG: $DMG"
