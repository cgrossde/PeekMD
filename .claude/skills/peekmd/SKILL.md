---
name: peekmd
description: >
  PeekMD is the Markdown viewer for this machine. Use it whenever the user asks
  to open, view, or preview a Markdown file. It replaces Marked. Also use it to
  resolve ambiguous file references ("which README do you mean?") by checking
  what the user already has open or recently closed.
---

# PeekMD — Markdown Viewer Skill

## When to use

- User asks to open, view, or preview a Markdown file (`.md`, `.markdown`, `.mdown`, `.mkd`).
- User mentions a filename without a path and you need to know which file they mean.
- User asks what Markdown files are currently open or were recently viewed.
- `/peekmd` or `/marked` command invoked.

Do NOT use when:
- User wants to read the raw source (use `read` tool).
- User wants to edit (use `edit`/`write` tools).

## CLI tool

`peekmd-cli` is a headless binary shipped alongside the app. On a Homebrew install it's on `PATH` at `/opt/homebrew/bin/peekmd-cli` (Apple Silicon) — invoke it as bare `peekmd-cli`. It's a symlink into the app bundle:

```
/opt/homebrew/bin/peekmd-cli → /Applications/PeekMD.app/Contents/MacOS/peekmd-cli
```

Development builds don't install to `/Applications`; the binary lives at `~/dev/PeekMD/src-tauri/target/release/peekmd-cli` (or wherever the repo is cloned).

Resolution order:
1. `command -v peekmd-cli` → use that.
2. `/Applications/PeekMD.app/Contents/MacOS/peekmd-cli` (Homebrew install without shell rehash, or manual DMG install).
3. `$(git rev-parse --show-toplevel 2>/dev/null)/src-tauri/target/release/peekmd-cli` (dev fallback — only when running from within the PeekMD repo).

## Subcommands

### `list` — query open and recent files

```bash
peekmd-cli list
```

Returns JSON:

```json
{
  "openDocs":      ["<abs-path>", ...],
  "activeDoc":     "<abs-path>" | null,
  "recentlyClosed": [
    { "path": "<abs-path>", "title": "<stem>", "closedAt": "<ISO8601>" },
    ...
  ]
}
```

Use this to:
- Show the user what they have open without asking.
- Resolve an ambiguous filename — if the user says "open the README" and `list` shows two READMEs, ask which one.
- Suggest recently closed files as candidates when the user asks for "the file I was looking at earlier".

### `open <path...>` — open one or more files

```bash
peekmd-cli open /abs/path/to/file.md /another/file.md
```

- Launches PeekMD in the background (no focus steal when the app is already running).
- Accepts absolute paths. Always resolve relative paths to absolute before passing.
- Multiple paths open as tabs in the sidebar.
- Exit 0 on success, 1 on failure.

## Resolving ambiguous references

1. Call `peekmd-cli list`.
2. Search `openDocs` and `recentlyClosed[*].path` for filenames matching the user's description (case-insensitive stem match).
3. If exactly one match → use it.
4. If multiple matches → ask the user to pick (show path and recency).
5. If no match → open a file picker or ask the user for the path.

## Opening files — decision tree

```
User asks to open / view a .md file
  ├─ Path is explicit and absolute → peekmd-cli open <path>
  ├─ Path is relative → resolve to absolute (pwd or repo root), then open
  └─ Only a name/description given
       ├─ peekmd-cli list → single match → open it
       ├─ peekmd-cli list → multiple matches → ask user
       └─ No match → ask user for path, then open
```

## Bash usage pattern

```bash
# Prefer PATH; fall back to installed app; final fallback dev build.
CLI="$(command -v peekmd-cli || true)"
[ -z "$CLI" ] && [ -x "/Applications/PeekMD.app/Contents/MacOS/peekmd-cli" ] && \
  CLI="/Applications/PeekMD.app/Contents/MacOS/peekmd-cli"
[ -z "$CLI" ] && [ -x "$HOME/dev/PeekMD/src-tauri/target/release/peekmd-cli" ] && \
  CLI="$HOME/dev/PeekMD/src-tauri/target/release/peekmd-cli"
[ -z "$CLI" ] && { echo "peekmd-cli not found" >&2; exit 1; }

"$CLI" list
"$CLI" open "/abs/path/to/file.md"
```

## Notes

- PeekMD is the **default** Markdown viewer on this machine (`rank: Owner` in the app bundle).
  Finder double-click and `open file.md` both route to PeekMD when it is installed.
- The app persists session state in `~/Library/Application Support/com.peekmd.desktop/state.json`.
  `peekmd-cli list` reads that file directly — the app does not need to be running.
- Multiple files can be opened in one call; they appear as tabs in the sidebar.
