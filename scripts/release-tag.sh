#!/usr/bin/env bash
# Usage: bash scripts/release-tag.sh 0.1.1
set -euo pipefail

VERSION="${1:?usage: $0 <version-without-v-prefix>}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must be X.Y.Z"; exit 1; }

# Working tree must be clean.
git diff --quiet && git diff --cached --quiet || { echo "working tree is dirty"; exit 1; }

# Bump Cargo.toml (first `version` under [package]).
sed -i '' -e '/^\[package\]/,/^\[/ s/^version = "[^"]*"/version = "'"$VERSION"'"/' src-tauri/Cargo.toml

# Bump tauri.conf.json + package.json (top-level "version" key, first occurrence).
python3 -c "
import json, sys
for p in ('src-tauri/tauri.conf.json', 'package.json'):
    d = json.load(open(p))
    d['version'] = '$VERSION'
    open(p, 'w').write(json.dumps(d, indent=2) + '\n')
"

# Refresh Cargo.lock so the version bump takes effect.
(cd src-tauri && cargo update -p peekmd --precise "$VERSION" 2>/dev/null || cargo check --quiet)

git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json package.json
git commit -m "chore(release): v$VERSION"
git tag "v$VERSION"

echo "✓ Ready. Push with: git push && git push --tags"
