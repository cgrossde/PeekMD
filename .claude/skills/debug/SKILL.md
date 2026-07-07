---
name: debug
description: >
  Debug the live PeekMD app — take screenshots, inspect rendered markdown HTML,
  query DOM state, evaluate JS, check theme, and interact with the webview.
  Use when verifying UI changes, checking rendering output, inspecting app state,
  or diagnosing visual bugs. Requires the app to be running via `bun run tauri dev`.
---

# PeekMD Debug

Direct control of the running PeekMD dev app via the `tauri-plugin-playwright` Unix socket.

## How it works

The Rust plugin (`tauri-plugin-playwright`) is compiled into debug builds only (gated by
`#[cfg(debug_assertions)]` in `src-tauri/src/lib.rs`). It opens a Unix socket at
`/tmp/tauri-playwright.sock` and accepts newline-delimited JSON commands.

For commands that need JS results (`eval`, `dom`, `style`, etc.): the plugin calls
`webview.eval()` with a wrapper script that executes the JS and calls back to Rust via
`plugin:playwright|pw_result` IPC. This requires `"playwright:default"` in the capabilities
file — already configured in `src-tauri/capabilities/default.json`.

## Control script

```
node ~/dev/PeekMD/.claude/skills/debug/peekmd-ctl.mjs <command> [args]
```

## Prerequisite: confirm the app is live

```bash
node ~/dev/PeekMD/.claude/skills/debug/peekmd-ctl.mjs ping
# Expected: pong
```

If the socket is missing, start the app:
```bash
cd ~/dev/PeekMD && bun run tauri dev -- -- /tmp/sample.md
```
First run compiles Rust (~45 s). Subsequent runs: ~5 s.

---

## Commands

### Screenshot — native macOS (the one that works)
```bash
node .../peekmd-ctl.mjs screenshot-native
node .../peekmd-ctl.mjs screenshot-native /tmp/peekmd-native.png
```
Captures the real macOS window at retina resolution, including title bar and shadow.
Works even when the window is behind other windows. **Use this for visual verification.**

> **Note:** `screenshot` (DOM canvas) fails with "canvas tainted: The operation is insecure"
> due to WKWebView's canvas security policy for `file://` resources. Use `screenshot-native`.

### Display a screenshot
After capturing, show it with the browser tool:
```js
await tab.goto('file:///tmp/peekmd-native.png');
await tab.screenshot();
```

### PeekMD-specific queries
```bash
# Current resolved theme: "light" or "dark"
node .../peekmd-ctl.mjs theme

# Currently loaded file path (reads .peekmd-topbar text)
node .../peekmd-ctl.mjs path

# Raw rendered HTML inside .markdown-body
node .../peekmd-ctl.mjs html
```

### Evaluate JavaScript
```bash
node .../peekmd-ctl.mjs eval "document.title"
node .../peekmd-ctl.mjs eval "document.querySelector('h1')?.textContent"
node .../peekmd-ctl.mjs eval "document.querySelectorAll('.markdown-body table').length"
node .../peekmd-ctl.mjs eval "sessionStorage.getItem('peekmd:theme')"
node .../peekmd-ctl.mjs eval "getComputedStyle(document.body).backgroundColor"
node .../peekmd-ctl.mjs eval "getComputedStyle(document.documentElement).getPropertyValue('--bgColor-default').trim()"
```

### Inspect DOM
```bash
# Full page HTML
node .../peekmd-ctl.mjs content

# innerHTML of a selector
node .../peekmd-ctl.mjs dom ".markdown-body"
node .../peekmd-ctl.mjs dom "h1"
node .../peekmd-ctl.mjs dom ".peekmd-topbar"

# Computed CSS value
node .../peekmd-ctl.mjs style "body" background-color
node .../peekmd-ctl.mjs style ".markdown-body" max-width
node .../peekmd-ctl.mjs style "code" font-family
```

### Click / interact
```bash
node .../peekmd-ctl.mjs click ".peekmd-topbar"

# Trigger ⌘⇧D theme toggle
node .../peekmd-ctl.mjs eval "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', metaKey: true, shiftKey: true, bubbles: true }))"

# Trigger ⌘R re-render
node .../peekmd-ctl.mjs eval "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', metaKey: true, bubbles: true }))"
```

---

## Typical debug workflows

### "Does the rendered HTML look right?"
```bash
node .../peekmd-ctl.mjs ping
node .../peekmd-ctl.mjs path           # which file is loaded
node .../peekmd-ctl.mjs html           # raw rendered HTML
node .../peekmd-ctl.mjs screenshot-native /tmp/snap.png
# Then in browser tool: await tab.goto('file:///tmp/snap.png'); await tab.screenshot();
```

### "Is dark mode working?"
```bash
node .../peekmd-ctl.mjs theme                                                               # current resolved theme
node .../peekmd-ctl.mjs style "body" background-color                                      # computed bg
node .../peekmd-ctl.mjs eval "getComputedStyle(document.documentElement).getPropertyValue('--bgColor-default').trim()"
node .../peekmd-ctl.mjs screenshot-native /tmp/light.png
node .../peekmd-ctl.mjs eval "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', metaKey: true, shiftKey: true, bubbles: true }))"
node .../peekmd-ctl.mjs screenshot-native /tmp/dark.png
```

### "Tables / code blocks / alerts rendering?"
```bash
node .../peekmd-ctl.mjs eval "document.querySelectorAll('.markdown-body table').length"
node .../peekmd-ctl.mjs eval "document.querySelectorAll('.markdown-body pre code').length"
node .../peekmd-ctl.mjs eval "document.querySelectorAll('.markdown-alert').length"
node .../peekmd-ctl.mjs dom ".markdown-alert"
```

### "Check a CSS variable"
```bash
node .../peekmd-ctl.mjs eval "getComputedStyle(document.documentElement).getPropertyValue('--bgColor-default').trim()"
node .../peekmd-ctl.mjs eval "getComputedStyle(document.documentElement).getPropertyValue('--fgColor-default').trim()"
node .../peekmd-ctl.mjs eval "getComputedStyle(document.documentElement).getPropertyValue('--borderColor-default').trim()"
```

---

## Safari Web Inspector (built-in)

In any dev build, `⌘⌥I` opens Safari's Web Inspector attached to the PeekMD WKWebView.
Full Elements / Network / Console / Sources / Timeline — same as browser devtools. No setup needed.

Tauri docs: https://v2.tauri.app/develop/debug/

---

## CrabNebula DevTools (optional — Tauri command/event inspector)

CrabNebula DevTools (`tauri-plugin-devtools`) instruments the Tauri layer: IPC commands,
events, spans, payloads. Complements Safari Web Inspector (which covers JS/DOM).

To add it:
```toml
# src-tauri/Cargo.toml [dependencies]
tauri-plugin-devtools = "2"
```
```rust
// src-tauri/src/lib.rs, inside run(), before Builder::default()
#[cfg(debug_assertions)]
let devtools = tauri_plugin_devtools::init();

// then in the builder chain:
#[cfg(debug_assertions)]
{ builder = builder.plugin(devtools); }
```
A link to the DevTools web UI is printed to the terminal on startup.
Docs: https://v2.tauri.app/develop/debug/crabnebula-devtools/

Not installed in Phase 1 — add if you need Tauri command tracing.

---

## Log inspection

```bash
# Tail live log
tail -f ~/Library/Logs/PeekMD\ Dev/peekmd.$(date +%Y-%m-%d).log

# Check last render event (path, bytes, duration)
grep "rendered" ~/Library/Logs/PeekMD\ Dev/peekmd.$(date +%Y-%m-%d).log | tail -5
```

---

## Socket protocol reference

The socket at `/tmp/tauri-playwright.sock` accepts newline-delimited JSON, one response per command.

```json
{"type":"ping"}
{"type":"native_screenshot","path":"/abs/path/out.png"}
{"type":"eval","script":"document.title"}
{"type":"click","selector":".peekmd-topbar","timeout_ms":5000}
{"type":"fill","selector":"input","text":"hello","timeout_ms":5000}
{"type":"is_visible","selector":".markdown-body"}
{"type":"text_content","selector":"h1","timeout_ms":5000}
{"type":"inner_html","selector":".markdown-body","timeout_ms":5000}
{"type":"get_computed_style","selector":"body","property":"background-color","timeout_ms":5000}
{"type":"count","selector":".markdown-body table"}
{"type":"content"}
{"type":"title"}
{"type":"url"}
```

All responses: `{"ok":true,"data":...}` or `{"ok":false,"error":"..."}`.

> `screenshot` (DOM canvas) is broken in WKWebView for `file://` resources — use `native_screenshot`.

---

## Notes

- Socket only present in debug builds. Release builds never expose it.
- After dispatching keyboard events, allow ~300 ms for React to re-render before screenshotting.
- If ping succeeds but `eval` times out: the `"playwright:default"` capability may be missing from
  `src-tauri/capabilities/default.json`. It must be present for `pw_result` IPC to be allowed.
- If the socket file exists but ping hangs: the window crashed — restart dev server.
