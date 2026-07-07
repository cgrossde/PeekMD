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

`peekmd-cli` is a headless binary shipped inside the app bundle. In development it lives at:

```
~/dev/PeekMD/src-tauri/target/release/peekmd-cli
```

Once the app is installed at `/Applications/PeekMD.app`:

```
/Applications/PeekMD.app/Contents/MacOS/peekmd-cli
```

Prefer the installed path; fall back to the dev path if the installed app is absent.

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
CLI_INSTALLED=/Applications/PeekMD.app/Contents/MacOS/peekmd-cli
CLI_DEV=~/dev/PeekMD/src-tauri/target/release/peekmd-cli
CLI=$([ -x "$CLI_INSTALLED" ] && echo "$CLI_INSTALLED" || echo "$CLI_DEV")

# Query state
"$CLI" list

# Open a file (always use absolute path)
"$CLI" open "/abs/path/to/file.md"
```

## Notes

- PeekMD is the **default** Markdown viewer on this machine (`rank: Owner` in the app bundle).
  Finder double-click and `open file.md` both route to PeekMD when it is installed.
- The app persists session state in `~/Library/Application Support/com.peekmd.desktop/state.json`.
  `peekmd-cli list` reads that file directly — the app does not need to be running.
- Multiple files can be opened in one call; they appear as tabs in the sidebar.
