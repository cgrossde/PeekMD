# Agent Skill

PeekMD ships a skill for AI coding agents (Claude Code, Oh-My-Pi / OMP, OpenCode). Once installed the skill lets agents open Markdown files, query what is currently open or recently closed, and disambiguate filenames — all without interrupting the user's focus.

## peekmd-cli

`peekmd-cli` is a headless binary bundled with the app. It has no GUI dependencies and does not require PeekMD to be running for read operations.

### Binary paths

| Context | Path |
|---|---|
| Installed app | `/Applications/PeekMD.app/Contents/MacOS/peekmd-cli` |
| Dev build | `~/dev/PeekMD/src-tauri/target/release/peekmd-cli` |

Prefer the installed path; fall back to the dev path when the installed app is absent:

```bash
CLI_INSTALLED=/Applications/PeekMD.app/Contents/MacOS/peekmd-cli
CLI_DEV=~/dev/PeekMD/src-tauri/target/release/peekmd-cli
CLI=$([ -x "$CLI_INSTALLED" ] && echo "$CLI_INSTALLED" || echo "$CLI_DEV")
```

### Subcommand: `list`

```bash
peekmd-cli list
```

Reads `~/Library/Application Support/com.peekmd.desktop/state.json` directly. The app does not need to be running. If the app has never run, returns an empty state rather than an error.

Output (pretty-printed JSON):

```json
{
  "openDocs": ["<abs-path>", "..."],
  "activeDoc": "<abs-path> or null",
  "recentlyClosed": [
    { "path": "<abs-path>", "title": "<stem>", "closedAt": "<ISO8601>" }
  ]
}
```

Exit codes: `0` on success, `1` on error (message to stderr).

### Subcommand: `open <path...>`

```bash
peekmd-cli open /abs/path/to/file.md /another/file.md
```

Opens one or more Markdown files in PeekMD without stealing focus. Always pass absolute paths.

The command tries two strategies in order:

1. **`open -g -b com.peekmd.desktop --args <paths>`** — uses macOS's `open` launcher with the `-g` (background, no focus steal) flag. Works when the signed `.app` is installed under `/Applications`.
2. **Direct binary exec** — if strategy 1 fails, looks for a `PeekMD` binary next to `peekmd-cli` in the same directory. This covers dev builds where the bundle launcher is not available.

If both strategies fail, the command prints an error to stderr and exits with code `1`.

## Agent detection

The `skill_install_status` Tauri command probes the system for known agents and reports whether the skill is already installed. It is called by the in-app install prompt at startup.

Detection is PATH-first (the binary the user actually invokes), with fallback probes for well-known installer locations:

| Agent | Binary | Fallback paths |
|---|---|---|
| Claude Code | `claude` | `~/.local/bin/claude` |
| Oh-My-Pi (OMP) | `omp` | `~/.bun/bin/omp`, `~/.local/bin/omp`, `/opt/homebrew/bin/omp`, `/usr/local/bin/omp`, `~/.omp/` (directory) |
| OpenCode | `opencode` | `~/.opencode/bin/opencode`, `~/bin/opencode` |

Return shape:

```json
{
  "agent_detected": true,
  "skill_installed": false,
  "agents": [
    { "name": "Claude Code", "binary": "claude" }
  ]
}
```

`skill_installed` is `true` when `~/.claude/skills/peekmd` exists (file, directory, or symlink).

## In-app install prompt

`SkillPrompt` is a dialog component shown once per launch of the main window when:

- `checkSkillPrompt()` returns `true`, which happens when `agent_detected && !skill_installed`, and
- `localStorage['peekmd-skill-prompt-never']` is not set.

The prompt asks: _"Install the PeekMD skill so your AI coding agent can open and query files for you?"_

| Button | Behaviour |
|---|---|
| **Install skill** | Calls the `install_agent_skill` Tauri command. On success shows a confirmation message; on failure shows the error. |
| **Later** | Calls `onDismiss` — hides the prompt for this launch; shown again on the next launch. |
| **Never** | Sets `localStorage['peekmd-skill-prompt-never'] = '1'` then calls `onDismiss` — prompt is never shown again for this installation. |

### What `install_agent_skill` does

1. Requires `~/.claude/skills/` to exist (created by Claude Code or OMP installation).
2. Locates the bundled skill directory — first in the app's resource directory (`skills/peekmd/`), then in the repo working directory (`.claude/skills/peekmd/`).
3. Creates or replaces `~/.claude/skills/peekmd` as a symlink to the skill source.
4. Creates or replaces `~/.claude/skills/marked` as a symlink to the same source (replaces the old Marked skill).

Returns the string `"Skill installed. Restart your agent session to pick it up."` on success, or an error string on failure.

## Manual install

Run from the repo root:

```bash
bash scripts/install-skill.sh
```

To preview what would happen without making changes:

```bash
bash scripts/install-skill.sh --dry-run
```

The script is idempotent. Re-running it updates symlink targets if they have drifted and does nothing if both symlinks are already correct.

The script requires `~/.claude/skills/` to exist. If it is absent the script exits with an error message suggesting that Claude Code or OMP needs to be installed first.

After install, restart your agent session so it picks up the new skill.

## Skill location

The skill file lives in the repository at:

```
.claude/skills/peekmd/SKILL.md
```

On install (via the in-app prompt or `install-skill.sh`) two symlinks are created:

```
~/.claude/skills/peekmd  →  <skill source>/
~/.claude/skills/marked  →  <skill source>/
```

Both names activate the same skill content. The `marked` name ensures agents configured for the older Marked viewer automatically route to PeekMD instead.

The skill instructs agents to use PeekMD whenever the user asks to open, view, or preview a Markdown file; to use `peekmd-cli list` to resolve ambiguous filenames; and to use `peekmd-cli open` to open files without interrupting the user's focus.
