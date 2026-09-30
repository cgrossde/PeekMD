---
name: debug
description: >
  Debug the live PeekMD development app through its tauri-plugin-playwright socket.
  Use for deterministic state, cursor, fixture, scenario, screenshot, HTML, and
  diagnostic-bundle workflows.
---

# PeekMD Debug Feedback Loop

The control CLI talks to the development-only Unix socket at
`/tmp/tauri-playwright.sock`. The application debug bridge is available only in
Vite development builds. Start the app first:

```bash
bun run tauri dev -- -- /tmp/sample.md
node .claude/skills/debug/peekmd-ctl.mjs ping
```

A production build has neither the socket nor `window.__PEEKMD_DEBUG__`.

## Global flags

Flags may appear anywhere in a command:

- `--json` emits a machine-readable envelope.
- `--verbose` writes socket requests and responses to stderr; stdout is unchanged.
- `--timeout MS` changes the default 2,000 ms timeout for `wait` commands.

Success JSON:

```json
{ "ok": true, "command": "cursor-state", "data": {} }
```

Failure JSON has a non-zero exit status and includes the last bridge snapshot when
available:

```json
{ "ok": false, "command": "wait mode editor", "error": "Timed out ...", "state": {} }
```

## Command grammar

Existing socket and DOM commands:

```text
ping
screenshot [PATH]
screenshot-native [PATH]
click CSS_SELECTOR
fill CSS_SELECTOR TEXT
press KEY [CSS_SELECTOR]
eval JAVASCRIPT
content
dom CSS_SELECTOR
style CSS_SELECTOR CSS_PROPERTY
theme
path
html
cursor-state
```

`cursor-state` requires the application debug bridge. It combines the semantic
`DebugSnapshot` with active-element data, native selection details, preview-caret
geometry, and editor-caret geometry. It fails with
`PeekMD debug bridge unavailable; run a development build` instead of returning
partial semantic state.

Cursor controls use the bridge, not synthetic CodeMirror key events:

```text
set-editor-cursor --offset N
set-editor-cursor --line N --column N
set-preview-cursor --selector CSS_SELECTOR --offset N
assert-cursor --editor-offset N
assert-cursor --line N --column N
assert-cursor --preview-selector CSS_SELECTOR --rendered-offset N
```

Exactly one editor addressing form and exactly one assertion form are required.
Editor line and column are one-based. Preview offsets are non-negative UTF-16
offsets across descendant text nodes of the selected element. Invalid selectors,
non-integers, and out-of-range positions fail.

Deterministic waits poll every 25 ms:

```text
wait mode empty|preview|editor [--timeout MS]
wait edit-status clean|dirty|saving|conflict|error [--timeout MS]
wait selector CSS_SELECTOR [--timeout MS]
wait cursor-visible [--timeout MS]
```

A timeout reports the final debug snapshot.

## Owned fixture workflows

```text
fixture open cursor
fixture replace --text TEXT
fixture replace --from FILE
fixture cleanup
```

`fixture open cursor` copies `.claude/skills/debug/fixtures/cursor.md` to a unique
OS-temporary directory and records its path in the socket-specific manifest.
`fixture replace` may write only that manifest-owned file. Replacement waits for a
revision change. `fixture cleanup` closes the document, removes only the recorded
temporary directory, then removes the manifest.

Safety rules:

- Replace and cleanup fail when no manifest-owned fixture is active.
- The manifest directory must be under the OS temporary `peekmd-debug-*` prefix.
- The fixture file must be inside that recorded directory.
- A malformed or out-of-prefix manifest is never deleted.
- A scenario using a pre-existing user document is read-only. Scenarios clean up
  fixtures they created, including after a failure.

## Scenarios

```text
scenario cursor-roundtrip [--selector CSS_SELECTOR --offset N]
scenario live-reload
scenario selection-drag
```

`cursor-roundtrip` opens the cursor fixture when needed, places a preview cursor,
round-trips through editor mode, and asserts exact source and rendered offsets plus
visible caret geometry. `live-reload` verifies stale native selection and preview
caret state are cleared after a fixture revision changes.

`selection-drag` runs the focused browser E2E test named
`preserves native text selection instead of replacing it with a preview cursor`.
It is explicitly browser coverage: synthetic WebView mouse events do not prove
native WKWebView drag selection.

## Diagnostic bundles

```text
diagnose cursor [--output DIRECTORY]
```

Without `--output`, the CLI creates a timestamped directory under the OS temporary
directory. An explicit directory must be empty. The bundle contains:

```text
summary.json
state.json
console.json
rendered.html
screenshot.png
app.log
```

State, HTML, screenshot, and log capture run independently; a failed non-critical
source is recorded and does not stop the other captures. State or screenshot
failure produces a non-zero exit status. `app.log` contains only the newest 200
lines from the newest `peekmd*.log` file in the development log directory.

Bundles stay local and are never uploaded. Rendered HTML, document paths, console
entries, and logs may contain private document data; treat the bundle accordingly.

## Visual verification and socket notes

Use the native screenshot for macOS window chrome and retina pixels:

```bash
node .claude/skills/debug/peekmd-ctl.mjs screenshot-native /tmp/peekmd-native.png
```

The socket accepts newline-delimited JSON and is present only in debug builds.
The DOM canvas screenshot can fail for `file://` resources; use
`screenshot-native` for visual verification.
