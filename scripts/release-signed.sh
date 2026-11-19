#!/usr/bin/env bash
# Build a Developer ID signed, hardened-runtime, notarized PeekMD DMG.
#
# Signing: APPLE_SIGNING_IDENTITY (and, in CI, APPLE_CERTIFICATE +
# APPLE_CERTIFICATE_PASSWORD, which Tauri imports into a temporary keychain).
# Notarization: either an App Store Connect API key
#   APPLE_API_ISSUER, APPLE_API_KEY, APPLE_API_KEY_PATH   (used by CI)
# or an Apple ID
#   APPLE_ID, APPLE_PASSWORD (app-specific password), APPLE_TEAM_ID
#
# Bundle layout: Tauri copies every enabled Cargo [[bin]] into
# Contents/MacOS/ and signs each one (hardened runtime, entitlements) before
# sealing the .app, so peekmd-cli ships at Contents/MacOS/peekmd-cli without
# any post-build patching. Never modify the .app after `cargo tauri build`:
# that breaks the seal and the notarization ticket.
set -euo pipefail

# Normalize CI=1/0 → true/false so cargo-tauri doesn't reject the value
case "${CI:-}" in
  1|true)  export CI=true  ;;
  0|false) export CI=false ;;
  *)       unset CI        ;;
esac

# Validate signing + notarization env up front. Tauri silently skips
# notarization when credentials are missing, so fail here instead.
: "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY not set (Developer ID Application cert name)}"
if [ "$APPLE_SIGNING_IDENTITY" = "-" ]; then
  echo "APPLE_SIGNING_IDENTITY is '-' (ad-hoc); release builds need a Developer ID identity" >&2
  exit 1
fi
if [ -n "${APPLE_API_ISSUER:-}" ] || [ -n "${APPLE_API_KEY:-}" ] || [ -n "${APPLE_API_KEY_PATH:-}" ]; then
  : "${APPLE_API_ISSUER:?APPLE_API_ISSUER not set (App Store Connect issuer ID)}"
  : "${APPLE_API_KEY:?APPLE_API_KEY not set (App Store Connect key ID)}"
  : "${APPLE_API_KEY_PATH:?APPLE_API_KEY_PATH not set (path to AuthKey_<id>.p8)}"
  [ -s "$APPLE_API_KEY_PATH" ] || { echo "APPLE_API_KEY_PATH does not point to a non-empty file" >&2; exit 1; }
  # Make sure the bundler cannot pick the Apple ID path instead.
  unset APPLE_ID APPLE_PASSWORD
else
  : "${APPLE_ID:?Set APPLE_API_ISSUER/APPLE_API_KEY/APPLE_API_KEY_PATH, or APPLE_ID (Apple ID email)}"
  : "${APPLE_PASSWORD:?APPLE_PASSWORD not set (app-specific password)}"
  : "${APPLE_TEAM_ID:?APPLE_TEAM_ID not set}"
fi

# Compile-only first to surface release-profile errors fast
cargo tauri build --no-bundle

# One bundling pass: build, sign (inside-out: peekmd-cli, then the .app),
# notarize + staple the .app, then build and sign the DMG from it.
cargo tauri build --bundles app,dmg

APP_DIR="src-tauri/target/release/bundle/macos/PeekMD.app"
DMG=$(ls -t src-tauri/target/release/bundle/dmg/PeekMD_*.dmg | head -1)

# Verify the sealed bundle, the nested helper, and the notarization tickets.
test -x "$APP_DIR/Contents/MacOS/peekmd-cli"
codesign --verify --deep --strict --verbose=2 "$APP_DIR"
codesign --verify --strict --verbose=2 "$APP_DIR/Contents/MacOS/peekmd-cli"
spctl --assess --type execute --verbose=2 "$APP_DIR"
xcrun stapler validate "$APP_DIR"

# Tauri signs the DMG but only notarizes the .app; notarize + staple the DMG
# too so it opens offline without a Gatekeeper network check.
if [ -n "${APPLE_API_KEY_PATH:-}" ]; then
  xcrun notarytool submit "$DMG" --wait \
    --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER"
else
  xcrun notarytool submit "$DMG" --wait \
    --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
fi
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

echo
echo "✓ Signed + notarized: $DMG"
