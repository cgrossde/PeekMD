#!/usr/bin/env bash
# install-skill.sh — install the PeekMD agent skill into ~/.claude/skills/
#
# Usage:
#   bash scripts/install-skill.sh            # from the repo root
#   bash scripts/install-skill.sh --dry-run  # print what would happen, no changes
#
# The skill directory lives at .claude/skills/peekmd/ relative to this repo.
# We symlink it into ~/.claude/skills/peekmd  (and also as ~/.claude/skills/marked
# to replace the old Marked skill).
#
# Idempotent: re-running updates the symlink targets if they've drifted.

set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in --dry-run|-n) DRY_RUN=true ;; esac
done

log()  { echo "  $*"; }
ok()   { echo "✓ $*"; }
skip() { echo "– $*"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_SRC="$REPO_ROOT/.claude/skills/peekmd"
SKILLS_DIR="$HOME/.claude/skills"

# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------

if [[ ! -f "$SKILL_SRC/SKILL.md" ]]; then
  echo "error: skill not found at $SKILL_SRC/SKILL.md" >&2
  exit 1
fi

if [[ ! -d "$SKILLS_DIR" ]]; then
  echo "error: ~/.claude/skills/ not found — is Claude Code / OMP installed?" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Install (or update) a symlink
# ---------------------------------------------------------------------------

install_link() {
  local name="$1"
  local target="$SKILLS_DIR/$name"

  # Already a correct symlink → nothing to do
  if [[ -L "$target" && "$(readlink "$target")" == "$SKILL_SRC" ]]; then
    skip "$name → already installed"
    return
  fi

  # Exists but wrong (stale symlink, old dir, or a real file)
  if [[ -e "$target" || -L "$target" ]]; then
    log "$name → replacing existing entry"
    if [[ "$DRY_RUN" == false ]]; then
      rm -rf "$target"
    fi
  fi

  log "$name → $SKILL_SRC"
  if [[ "$DRY_RUN" == false ]]; then
    ln -s "$SKILL_SRC" "$target"
  fi
  ok "$name installed"
}

echo "Installing PeekMD skill into $SKILLS_DIR/"
[[ "$DRY_RUN" == true ]] && echo "(dry run — no changes will be made)"
echo

install_link "peekmd"
install_link "marked"   # replaces the old Marked 2 skill

echo
echo "Done. Restart your agent session to pick up the skill."
