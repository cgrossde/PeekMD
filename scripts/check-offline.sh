#!/usr/bin/env bash
set -euo pipefail

bun run build

if grep -rE 'https?://(cdn|fonts\.gstatic|fonts\.googleapis|unpkg|cdnjs|jsdelivr)' dist/ src/vendor/ 2>/dev/null; then
  echo "FAIL: CDN reference found in shipped bundle" >&2
  exit 1
fi

echo "OK: no CDN references in dist/ or src/vendor/"
