/// Agent skill installation helpers.
///
/// Detects installed AI coding agents (Claude Code / OMP, OpenCode) and
/// installs the PeekMD skill into ~/.claude/skills/ by symlinking the
/// bundled skill directory.
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/// An agent we know how to detect.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DetectedAgent {
    pub name: &'static str,
    pub binary: &'static str,
}

/// Return all agents present on this machine.
///
/// Detection is PATH-first (same binary that the user actually runs), with
/// fallback probes for the well-known install locations used by each tool's
/// official installer.
pub fn detect_agents() -> Vec<DetectedAgent> {
    let mut found = Vec::new();

    // Claude Code: binary `claude`
    // Official installer: ~/.local/bin/claude. Config dir ~/.claude/ exists
    // even on OMP installs that bundle claude, so treat binary-or-dir as signal.
    if which("claude") || exists_at(&[home(".local/bin/claude")]) {
        found.push(DetectedAgent { name: "Claude Code", binary: "claude" });
    }

    // Oh-My-Pi (OMP): binary `omp`
    // Installers: bun global → ~/.bun/bin/omp, Homebrew → /opt/homebrew/bin/omp,
    // install script → ~/.local/bin/omp. Config dir: ~/.omp/
    if which("omp")
        || exists_at(&[
            home(".bun/bin/omp"),
            home(".local/bin/omp"),
            PathBuf::from("/opt/homebrew/bin/omp"),
            PathBuf::from("/usr/local/bin/omp"),
        ])
        || dir_exists(home(".omp"))
    {
        found.push(DetectedAgent { name: "Oh-My-Pi", binary: "omp" });
    }

    // OpenCode: binary `opencode`
    // Official installer fallbacks: ~/.opencode/bin/opencode, ~/bin/opencode
    if which("opencode")
        || exists_at(&[home(".opencode/bin/opencode"), home("bin/opencode")])
    {
        found.push(DetectedAgent { name: "OpenCode", binary: "opencode" });
    }

    found
}

fn home(rel: &str) -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/"))
        .join(rel)
}

fn which(bin: &str) -> bool {
    std::process::Command::new("which")
        .arg(bin)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn exists_at(paths: &[PathBuf]) -> bool {
    paths.iter().any(|p| p.exists())
}

fn dir_exists(p: PathBuf) -> bool {
    p.is_dir()
}

// ---------------------------------------------------------------------------
// Install state
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize)]
pub struct SkillStatus {
    /// At least one supported agent is detected.
    pub agent_detected: bool,
    /// The skill symlink is already in place.
    pub skill_installed: bool,
    /// Agents found (may be empty).
    pub agents: Vec<DetectedAgent>,
}

fn skills_dir() -> Option<PathBuf> {
    let d = home(".claude/skills");
    if d.is_dir() { Some(d) } else { None }
}

fn skill_is_installed() -> bool {
    let Some(dir) = skills_dir() else { return false };
    dir.join("peekmd").exists()
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn skill_install_status() -> SkillStatus {
    let agents = detect_agents();
    let agent_detected = !agents.is_empty();
    let skill_installed = skill_is_installed();
    SkillStatus { agent_detected, skill_installed, agents }
}

#[tauri::command]
pub fn install_agent_skill(app: AppHandle) -> Result<String, String> {
    let skills_dir = skills_dir()
        .ok_or_else(|| "~/.claude/skills/ not found — is Claude Code or OMP installed?".to_string())?;

    // Locate the bundled skill directory.
    // In a released .app the resource dir holds everything under `resources/`.
    // During dev the repo root is the working dir.
    let skill_src = locate_skill_src(&app)?;

    install_link(&skills_dir, "peekmd", &skill_src)?;
    install_link(&skills_dir, "marked", &skill_src)?;

    Ok("Skill installed. Restart your agent session to pick it up.".to_string())
}

fn locate_skill_src(app: &AppHandle) -> Result<PathBuf, String> {
    // 1. Bundled resource (installed .app)
    if let Ok(res) = app.path().resource_dir() {
        let candidate = res.join("skills").join("peekmd");
        if candidate.join("SKILL.md").exists() {
            return Ok(candidate);
        }
    }
    // 2. Repo checkout — dev builds run from the repo root or src-tauri/
    for prefix in &[".", ".."] {
        let candidate = PathBuf::from(prefix)
            .join(".claude")
            .join("skills")
            .join("peekmd");
        if candidate.join("SKILL.md").exists() {
            return Ok(candidate.canonicalize().map_err(|e| e.to_string())?);
        }
    }
    Err("Cannot locate PeekMD skill source directory. Try re-installing the app.".to_string())
}

fn install_link(skills_dir: &PathBuf, name: &str, target: &PathBuf) -> Result<(), String> {
    let link = skills_dir.join(name);

    // Already a correct symlink — nothing to do.
    if link.is_symlink() {
        if let Ok(existing) = std::fs::read_link(&link) {
            if existing == *target {
                return Ok(());
            }
        }
        // Stale symlink — remove it.
        std::fs::remove_file(&link).map_err(|e| format!("remove {}: {e}", link.display()))?;
    } else if link.exists() {
        // A real directory/file from a prior install — remove it.
        std::fs::remove_dir_all(&link).map_err(|e| format!("remove {}: {e}", link.display()))?;
    }

    std::os::unix::fs::symlink(target, &link)
        .map_err(|e| format!("symlink {name}: {e}"))
}
