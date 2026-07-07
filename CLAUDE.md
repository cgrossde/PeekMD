# PeekMD

Tauri v2 + React 19 GitHub-flavored Markdown previewer for macOS.

## Stack

- **Frontend**: React 19, Vite 7, Tailwind 4, TypeScript 5.8
- **Runtime**: Tauri v2, WKWebView
- **Renderer**: comrak 0.52 (GFM + extensions)
- **Package manager**: bun

## Commands

```bash
bun run dev              # Vite dev server only (no Tauri)
bun run tauri dev -- -- /path/to/file.md   # full dev app
bun run build            # TS typecheck + Vite production build
bun run check-offline    # verify no CDN refs in bundle
cargo check              # (from src-tauri/) Rust typecheck
bash scripts/release-unsigned.sh   # build unsigned DMG
bash scripts/install-skill.sh      # install agent skill into ~/.claude/skills/

bun run test             # frontend unit tests (vitest)
cargo test               # (from src-tauri/) Rust unit tests
```

```bash
# E2E tests — browser mode (no app needed, IPC mocked; CI-friendly)
bunx playwright test --project=browser

# E2E tests — tauri mode (controls the real running app via socket)
# App must already be running via `bun run tauri dev`
bunx playwright test --project=tauri
```

## Phases

- **Phase 1** ✅ — single file open, GFM render, light/dark theme, CLI arg / ⌘O / drag-drop, DMG
- **Phase 2** ✅ — file watcher, scroll-to-change, syntax highlighting (syntect), store persistence, multi-doc sidebar, recently closed, command palette, find bar, TOC, navigation history, Mermaid, drag-to-detach, document link navigation, agent skill
- **Phase 3** — accessibility pass, performance benchmarks, app icon, notarized signed DMG, CI

## Documentation

Full feature docs live in `docs/`. Key files:

| Topic | File |
| --- | --- |
| Keyboard shortcuts | `docs/keyboard-shortcuts.md` |
| Sidebar (resize, disambiguation, context menu) | `docs/sidebar.md` |
| Live reload and scroll-to-change | `docs/live-reload.md` |
| Session persistence | `docs/persistence.md` |
| Command palette | `docs/command-palette.md` |
| Find in document | `docs/find.md` |
| Table of contents | `docs/toc.md` |
| Navigation history and document links | `docs/navigation.md` |
| Mermaid diagrams | `docs/mermaid.md` |
| Light / dark theme | `docs/theme.md` |
| Agent skill (peekmd-cli) | `docs/agent-skill.md` |
| Markdown rendering (comrak, RenderedDoc) | `docs/rendering.md` |
| IPC surface — commands, events, capabilities | `docs/ipc.md` |

## Skills and CLI

`.claude/skills/debug/` — screenshots, JS eval, DOM inspection via `tauri-plugin-playwright` socket.
Requires dev build. See skill for usage.

`.claude/skills/peekmd/` (also symlinked as `marked`) — agent skill for opening and querying PeekMD.
Uses `peekmd-cli` binary:

```bash
# Installed app:
/Applications/PeekMD.app/Contents/MacOS/peekmd-cli list   # query open/recent docs
/Applications/PeekMD.app/Contents/MacOS/peekmd-cli open /path/to/file.md

# Dev build fallback (binary built alongside main app):
src-tauri/target/release/peekmd-cli list
```

Install or update the skill symlinks:

```bash
bash scripts/install-skill.sh
```

## Privacy

NEVER include any of the following in responses, commits, PR descriptions, gists, or any output that could leave this machine:

- Real usernames, login names, or employee IDs
- Absolute paths containing a username — use `~` or relative paths instead
- Internal hostnames, server names, or IP addresses
- Internal Jira/Azure/Slack URLs, ticket IDs, or org names beyond what is explicitly provided for the task
- Credentials, tokens, secrets, or anything resembling one
- Personal data about colleagues (names, roles, org structure)

When a tool returns a path or username, do not echo it back in prose or code examples.
