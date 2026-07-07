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

# Signed + notarized bundle
# - signingIdentity from APPLE_SIGNING_IDENTITY env (read by tauri-bundler)
# - notarization from APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID
# - hardenedRuntime enabled via CLI override (kept off in tauri.conf.json so unsigned builds stay loose)
cargo tauri build --config '{"bundle":{"macOS":{"hardenedRuntime":true}}}'

APP="src-tauri/target/release/bundle/macos/PeekMD.app"
DMG=$(ls -t src-tauri/target/release/bundle/dmg/PeekMD_*.dmg | head -1)

codesign --verify --deep --strict --verbose=2 "$APP"
xcrun stapler validate "$DMG"

echo
echo "✓ Signed + notarized: $DMG"
