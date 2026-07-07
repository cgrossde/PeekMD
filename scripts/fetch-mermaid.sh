#!/usr/bin/env bash
# Fetches the vendored mermaid tiny build.
# Run: bash scripts/fetch-mermaid.sh
set -euo pipefail

DEST="src/vendor/mermaid.tiny.min.js"
URL="https://cdn.jsdelivr.net/npm/@mermaid-js/tiny@11/dist/mermaid.tiny.js"
MIN_BYTES=102400  # 100 KB guard

curl -fsSL "$URL" -o "$DEST"

SIZE=$(wc -c < "$DEST" | tr -d ' ')
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  echo "ERROR: $DEST is only ${SIZE} bytes — expected >${MIN_BYTES}. Aborting." >&2
  rm -f "$DEST"
  exit 1
fi

echo "Fetched $DEST (${SIZE} bytes)"

# Verify the file contains no CDN references (mermaid tiny bakes none in).
if grep -qE 'https://cdn\.|fonts\.googleapis' "$DEST"; then
  echo "WARNING: $DEST contains external CDN references — review before shipping." >&2
fi
