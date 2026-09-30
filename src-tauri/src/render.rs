use std::fmt::Write as _;
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{FileExt, MetadataExt};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;
use comrak::{create_formatter, options, parse_document, Anchorizer, Arena, Options};
use comrak::html::{collect_text, render_sourcepos};
use comrak::nodes::{AstNode, NodeValue};
use comrak::plugins::syntect::SyntectAdapter;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct FileRevision {
    pub sha256: String,
    pub len: u64,
    pub file_id: String,
}

#[derive(Serialize, Clone)]
pub struct Heading {
    pub id: String,
    pub level: u8,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct RenderedDoc {
    pub html: String,
    pub title: String,
    pub path: String,
    pub headings: Vec<Heading>,
    pub mtime: u64,
    pub revision: FileRevision,
    /// Absolute paths of local images referenced by the document.
    /// Used by the watcher to re-render when an image file changes.
    pub local_images: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum MarkdownSaveResult {
    Updated { document: RenderedDoc },
    Conflict { latest: EditableDocument, reason: MarkdownSaveConflict },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum MarkdownSaveConflict {
    RevisionChanged,
    FileReplaced,
    ConcurrentWrite,
}

#[derive(Serialize, Clone)]
pub struct EditableDocument {
    pub source: String,
    pub line_separator: String,
    pub document: RenderedDoc,
}

#[derive(Serialize, Clone)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TaskEditResult {
    Updated { document: RenderedDoc },
    Conflict { document: RenderedDoc, reason: TaskEditConflict },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum TaskEditConflict {
    RevisionChanged,
    MarkerChanged,
    FileReplaced,
    ConcurrentWrite,
}
#[derive(Default)]
pub struct DocumentEditState(pub Mutex<()>);

fn validate_markdown_path(path: &Path) -> Result<(), String> {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if matches!(ext.as_str(), "md" | "markdown" | "mdown" | "mkd") {
        Ok(())
    } else {
        Err(format!("not markdown: {}", path.display()))
    }
}

struct FileSnapshot {
    bytes: Vec<u8>,
    metadata: std::fs::Metadata,
    revision: FileRevision,
}

#[derive(thiserror::Error, Debug)]
pub enum RenderError {
    #[error("read failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("not markdown: {0}")]
    NotMarkdown(String),
    #[error("stat failed: {0}")]
    Stat(String),
}

impl serde::Serialize for RenderError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

static SYNTECT: OnceLock<SyntectAdapter> = OnceLock::new();

fn syntect_adapter() -> &'static SyntectAdapter {
    SYNTECT.get_or_init(|| SyntectAdapter::new(None))
}

fn build_options<'a>() -> Options<'a> {
    let mut opts = Options::default();
    // GFM
    opts.extension.table = true;
    opts.extension.tasklist = true;
    opts.extension.strikethrough = true;
    opts.extension.autolink = true;
    opts.extension.footnotes = true;
    opts.extension.inline_footnotes = true;
    opts.extension.tagfilter = true;
    opts.extension.alerts = true;
    // Comrak extras per SPEC
    opts.extension.superscript = true;
    opts.extension.subscript = true;
    opts.extension.highlight = true;
    opts.extension.insert = true;
    opts.extension.underline = true;
    opts.extension.multiline_block_quotes = true;
    opts.extension.front_matter_delimiter = Some("---".into());
    opts.extension.header_id_prefix = Some("peekmd-".into());
    // Include task-list classes so the vendored GitHub Markdown CSS can remove
    // list markers from checkbox items.
    opts.render.tasklist_classes = true;
    // Phase 2: sourcepos enabled for scroll-to-change
    opts.render.sourcepos = true;
    // `unsafe = true` + `tagfilter = true`: render raw inline HTML (common in
    // real-world READMEs — <details>, <br>, <img align>, badge <picture>
    // blocks) while tagfilter blocklists <script>, <iframe>, <style>, etc.
    // per the GFM spec. tagfilter has NO effect while unsafe is false — the
    // two must be enabled together, which is why unsafe flips here. This does
    // NOT sanitize inline event-handler attributes (onerror=, onload=, ...);
    // the CSP in tauri.conf.json (script-src without 'unsafe-inline') is the
    // actual backstop against that residual vector.
    opts.render.r#unsafe = true;
    opts
}

create_formatter!(InteractiveHtmlFormatter, {
    NodeValue::TaskItem(ref nti) => |context, node, entering| {
        let write_li = node.parent()
            .map(|parent| matches!(&parent.data().value, NodeValue::List(_)))
            .unwrap_or(false);
        if entering {
            context.cr()?;
            if write_li {
                context.write_str("<li")?;
                if context.options.render.tasklist_classes {
                    context.write_str(" class=\"task-list-item\"")?;
                }
                render_sourcepos(context, node)?;
                context.write_str(">")?;
            }
            context.write_str("<input type=\"checkbox\"")?;
            if !write_li {
                render_sourcepos(context, node)?;
            }
            if context.options.render.tasklist_classes {
                context.write_str(" class=\"task-list-item-checkbox\"")?;
            }
            let line = nti.symbol_sourcepos.start.line;
            let column = nti.symbol_sourcepos.start.column;
            context.write_str(&format!(" data-task-line=\"{line}\" data-task-column=\"{column}\""))?;
            if nti.symbol.is_some() {
                context.write_str(" checked=\"\"")?;
            }
            let state = if nti.symbol.is_some() { "incomplete" } else { "complete" };
            context.write_str(&format!(" aria-label=\"Mark task on line {line} {state}\""))?;
            context.write_str(" /> ")?;
        } else if write_li {
            context.write_str("</li>")?;
            context.lf()?;
        }
    },
});

/// Walks the parsed AST (not the rendered HTML string) to collect headings.
///
/// This mirrors exactly what comrak's own HTML formatter does for
/// `header_id_prefix` (see comrak's `html.rs::render_heading`): anchorize the
/// heading's collected text with a fresh `Anchorizer`, per document, in
/// document order, then prefix it. Walking the AST directly — rather than
/// re-scanning our own rendered HTML for `<h#>`/`id="peekmd-…"` — means this
/// can't drift out of sync with however comrak happens to nest the anchor
/// markup inside a heading; it uses the same public building blocks comrak's
/// formatter uses internally.
///
/// Returns an empty list if `header_id_prefix` isn't set, since headings are
/// only useful to the TOC / command palette as jump targets with an id.
fn extract_headings<'a>(root: &'a AstNode<'a>, options: &Options) -> Vec<Heading> {
    let mut headings = Vec::new();
    let Some(prefix) = options.extension.header_id_prefix.as_ref() else {
        return headings;
    };
    let mut anchorizer = Anchorizer::new();
    for node in root.descendants() {
        let level = match node.data.borrow().value {
            NodeValue::Heading(ref nh) => nh.level,
            _ => continue,
        };
        let text = collect_text(node);
        let slug = anchorizer.anchorize(&text);
        headings.push(Heading { id: format!("{prefix}{slug}"), level, text });
    }
    headings
}

/// Walks the AST and collects absolute paths of local images.
/// Skips URLs (http/https/data), fragment-only refs, and paths that don't
/// resolve to an existing file relative to the document's directory.
fn extract_local_images<'a>(root: &'a AstNode<'a>, md_path: &Path) -> Vec<String> {
    let base = match md_path.parent() {
        Some(p) => p.to_path_buf(),
        None => return vec![],
    };
    let mut images = Vec::new();
    for node in root.descendants() {
        let url = match node.data.borrow().value {
            NodeValue::Image(ref link) => link.url.clone(),
            _ => continue,
        };
        // Skip remote URLs and data URIs
        if url.starts_with("http://") || url.starts_with("https://")
            || url.starts_with("data:") || url.starts_with('#')
        {
            continue;
        }
        // Strip query/fragment so we can resolve the path
        let raw = url.split(&['?', '#'][..]).next().unwrap_or(&url);
        if raw.is_empty() { continue; }
        let abs = if std::path::Path::new(raw).is_absolute() {
            std::path::PathBuf::from(raw)
        } else {
            base.join(raw)
        };
        if let Ok(canon) = abs.canonicalize() {
            let s = canon.to_string_lossy().into_owned();
            if !images.contains(&s) {
                images.push(s);
            }
        }
    }
    images
}

/// Rewrites `src="<local-path>"` attributes in rendered HTML to append
/// `?v=<mtime>` so WKWebView (which aggressively caches by URL) is forced
/// to re-fetch the image bytes when the file changes on disk.
///
/// Only local paths are touched — `http://`, `https://`, and `data:` srcs
/// are left as-is. The rewrite is a plain string scan; no HTML parser needed
/// because comrak produces predictable `<img src="...">` output.
fn stamp_image_srcs(html: &mut String, md_path: &Path) {
    let base = match md_path.parent() {
        Some(p) => p.to_path_buf(),
        None => return,
    };
    let mut out = String::with_capacity(html.len() + 64);
    let mut rest = html.as_str();
    while let Some(pos) = rest.find(" src=\"") {
        out.push_str(&rest[..pos + 6]); // up to and including src="
        rest = &rest[pos + 6..];
        let end = match rest.find('"') {
            Some(e) => e,
            None => break,
        };
        let raw_src = &rest[..end];
        rest = &rest[end..]; // keep the closing quote in rest
        // Skip remote / data URIs unchanged
        if raw_src.starts_with("http://") || raw_src.starts_with("https://")
            || raw_src.starts_with("data:") || raw_src.starts_with('#')
        {
            out.push_str(raw_src);
            continue;
        }
        // Strip any existing query/fragment before resolving
        let file_part = raw_src.split(&['?', '#'][..]).next().unwrap_or(raw_src);
        if file_part.is_empty() { out.push_str(raw_src); continue; }
        let abs = if std::path::Path::new(file_part).is_absolute() {
            std::path::PathBuf::from(file_part)
        } else {
            base.join(file_part)
        };
        let mtime = std::fs::metadata(&abs)
            .and_then(|m| m.modified())
            .map(|t| t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
            .unwrap_or(0);
        if mtime > 0 {
            out.push_str(raw_src);
            out.push_str(&format!("?v={mtime}"));
        } else {
            out.push_str(raw_src);
        }
    }
    if !out.is_empty() {
        out.push_str(rest);
        *html = out;
    }
}

fn file_id(metadata: &std::fs::Metadata) -> String {
    format!("{}:{}", metadata.dev(), metadata.ino())
}

fn revision_for(bytes: &[u8], metadata: &std::fs::Metadata) -> FileRevision {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    FileRevision {
        sha256: format!("{:x}", hasher.finalize()),
        len: bytes.len() as u64,
        file_id: file_id(metadata),
    }
}

fn read_snapshot(file: &mut std::fs::File) -> Result<FileSnapshot, std::io::Error> {
    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let metadata = file.metadata()?;
    let revision = revision_for(&bytes, &metadata);
    Ok(FileSnapshot { bytes, metadata, revision })
}

fn markdown_source(bytes: &[u8]) -> Result<&str, RenderError> {
    std::str::from_utf8(bytes).map_err(|err| RenderError::Io(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        err,
    )))
}


fn render_snapshot(path: &Path, snapshot: &FileSnapshot) -> Result<RenderedDoc, RenderError> {
    let source = markdown_source(&snapshot.bytes)?;
    render_source(path, snapshot, source)
}

fn render_source(path: &Path, snapshot: &FileSnapshot, source: &str) -> Result<RenderedDoc, RenderError> {
    let opts = build_options();
    let start = std::time::Instant::now();
    let mut plugins = options::Plugins::default();
    plugins.render.codefence_syntax_highlighter = Some(syntect_adapter());

    let arena = Arena::new();
    let root = parse_document(&arena, &source, &opts);
    let headings = extract_headings(root, &opts);
    let local_images = extract_local_images(root, path);
    let mut html = String::new();
    InteractiveHtmlFormatter::format_document_with_plugins(root, &opts, &mut html, &plugins)
        .expect("formatting HTML into an in-memory buffer should never fail");
    stamp_image_srcs(&mut html, path);

    tracing::info!(
        target: "peekmd::render",
        path = %path.display(),
        bytes = source.len(),
        took_ms = start.elapsed().as_millis() as u64,
        "rendered"
    );
    let mtime = snapshot.metadata
        .modified()
        .map(|t| t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
        .map_err(|e| RenderError::Stat(e.to_string()))?;
    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();
    Ok(RenderedDoc {
        html,
        title,
        path: path.to_string_lossy().into_owned(),
        headings,
        mtime,
        revision: snapshot.revision.clone(),
        local_images,
    })
}

#[tauri::command]
pub fn render_markdown(path: PathBuf) -> Result<RenderedDoc, RenderError> {
    validate_markdown_path(&path).map_err(|_| RenderError::NotMarkdown(path.to_string_lossy().into_owned()))?;
    let mut file = std::fs::File::open(&path)?;
    let snapshot = read_snapshot(&mut file)?;
    render_snapshot(&path, &snapshot)
}

fn line_separator(source: &str) -> &'static str {
    let bytes = source.as_bytes();
    for i in 0..bytes.len() {
        match bytes[i] {
            b'\r' if bytes.get(i + 1) == Some(&b'\n') => return "\r\n",
            b'\r' | b'\n' => return if bytes[i] == b'\r' { "\r" } else { "\n" },
            _ => {}
        }
    }
    "\n"
}

fn editable_from_snapshot(path: &Path, snapshot: &FileSnapshot) -> Result<EditableDocument, RenderError> {
    let source = markdown_source(&snapshot.bytes)?;
    Ok(EditableDocument {
        source: source.to_owned(),
        line_separator: line_separator(source).to_owned(),
        document: render_source(path, snapshot, source)?,
    })
}

#[tauri::command]
pub fn read_markdown_source(path: PathBuf) -> Result<EditableDocument, RenderError> {
    validate_markdown_path(&path).map_err(|_| RenderError::NotMarkdown(path.to_string_lossy().into_owned()))?;
    let mut file = std::fs::File::open(&path)?;
    let snapshot = read_snapshot(&mut file)?;
    editable_from_snapshot(&path, &snapshot)
}

fn markdown_conflict(path: &Path, reason: MarkdownSaveConflict) -> Result<MarkdownSaveResult, String> {
    read_markdown_source(path.to_path_buf())
        .map(|latest| MarkdownSaveResult::Conflict { latest, reason })
        .map_err(|err| format!("markdown save conflict read failed: {err}"))
}

#[tauri::command]
pub fn save_markdown_source(
    state: tauri::State<'_, DocumentEditState>,
    path: PathBuf,
    source: String,
    expected_revision: FileRevision,
) -> Result<MarkdownSaveResult, String> {
    save_markdown_source_inner(&state, path, source, expected_revision)
}

fn save_markdown_source_inner(
    state: &DocumentEditState,
    path: PathBuf,
    source: String,
    expected_revision: FileRevision,
) -> Result<MarkdownSaveResult, String> {
    save_markdown_source_inner_with_post_write(state, path, source, expected_revision, |_| {})
}

fn save_markdown_source_inner_with_post_write<F>(
    state: &DocumentEditState,
    path: PathBuf,
    source: String,
    expected_revision: FileRevision,
    post_write: F,
) -> Result<MarkdownSaveResult, String>
where
    F: FnOnce(&Path),
{
    validate_markdown_path(&path)?;
    let _guard = state.0.lock();
    let canonical = path.canonicalize().map_err(|err| format!("markdown save canonicalize failed: {err}"))?;
    let mut file = std::fs::OpenOptions::new().read(true).write(true).open(&canonical)
        .map_err(|err| format!("markdown save open failed: {err}"))?;
    let initial = read_snapshot(&mut file).map_err(|err| format!("markdown save read failed: {err}"))?;
    if initial.revision.file_id != expected_revision.file_id {
        return markdown_conflict(&path, MarkdownSaveConflict::FileReplaced);
    }
    if initial.revision.sha256 != expected_revision.sha256 || initial.revision.len != expected_revision.len {
        return markdown_conflict(&path, MarkdownSaveConflict::RevisionChanged);
    }

    // Render before mutating the existing inode. Writing through this descriptor
    // preserves ownership/ACL metadata and means an editor that atomically
    // replaces the path after this check receives a conflict during verification
    // instead of being overwritten by a rename.
    let target_metadata = file.metadata().map_err(|err| format!("markdown save stat failed: {err}"))?;
    let planned = FileSnapshot {
        bytes: source.as_bytes().to_vec(),
        revision: revision_for(source.as_bytes(), &target_metadata),
        metadata: target_metadata,
    };
    let document = render_source(&path, &planned, &source)
        .map_err(|err| format!("markdown save render failed: {err}"))?;

    file.seek(SeekFrom::Start(0)).map_err(|err| format!("markdown save recheck seek failed: {err}"))?;
    let before_write = read_snapshot(&mut file).map_err(|err| format!("markdown save recheck failed: {err}"))?;
    let current_path_metadata = std::fs::metadata(&canonical)
        .map_err(|err| format!("markdown save recheck stat failed: {err}"))?;
    if before_write.revision.file_id != initial.revision.file_id || file_id(&current_path_metadata) != initial.revision.file_id {
        return markdown_conflict(&path, MarkdownSaveConflict::FileReplaced);
    }
    if before_write.revision.sha256 != initial.revision.sha256 || before_write.revision.len != initial.revision.len {
        return markdown_conflict(&path, MarkdownSaveConflict::RevisionChanged);
    }

    file.set_len(0).map_err(|err| format!("markdown save truncate failed: {err}"))?;
    file.seek(SeekFrom::Start(0)).map_err(|err| format!("markdown save write seek failed: {err}"))?;
    file.write_all(source.as_bytes()).map_err(|err| format!("markdown save write failed: {err}"))?;
    file.flush().map_err(|err| format!("markdown save flush failed: {err}"))?;
    if let Err(err) = file.sync_all() {
        tracing::warn!("markdown save file sync failed after commit: {err}");
    }
    post_write(&canonical);
    let after_write = read_snapshot(&mut file).map_err(|err| format!("markdown save verification failed: {err}"))?;
    if after_write.bytes != source.as_bytes() {
        return markdown_conflict(&path, MarkdownSaveConflict::ConcurrentWrite);
    }
    match std::fs::metadata(&canonical) {
        Ok(metadata) if file_id(&metadata) != initial.revision.file_id => {
            return markdown_conflict(&path, MarkdownSaveConflict::FileReplaced);
        }
        Ok(_) => {}
        Err(err) => tracing::warn!("markdown save path verification failed after commit: {err}"),
    }
    if let Some(parent) = canonical.parent() {
        if let Err(err) = std::fs::File::open(parent).and_then(|dir| dir.sync_all()) {
            tracing::warn!("markdown save directory sync failed after commit: {err}");
        }
    }
    Ok(MarkdownSaveResult::Updated { document })
}
fn line_start(bytes: &[u8], line: usize) -> Option<usize> {
    if line == 0 { return None; }
    let mut offset = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) { 3 } else { 0 };
    let mut current = 1;
    if line == current { return Some(offset); }
    while offset < bytes.len() {
        match bytes[offset] {
            b'\n' => { offset += 1; current += 1; }
            b'\r' => { offset += 1; if bytes.get(offset) == Some(&b'\n') { offset += 1; } current += 1; }
            _ => offset += 1,
        }
        if line == current { return Some(offset); }
    }
    None
}

fn byte_offset_for_position(bytes: &[u8], line: usize, column: usize) -> Option<usize> {
    if column == 0 { return None; }
    let mut offset = line_start(bytes, line)?;
    let mut visual_column = 1;
    while offset < bytes.len() {
        if visual_column == column { return Some(offset); }
        match bytes[offset] {
            b'\n' | b'\r' => break,
            b'\t' => visual_column += 4 - ((visual_column - 1) % 4),
            _ => visual_column += 1,
        }
        offset += 1;
    }
    (visual_column == column).then_some(offset)
}

fn task_marker_offset(bytes: &[u8], line: usize, column: usize, checked: bool) -> Result<usize, TaskEditConflict> {
    let source = String::from_utf8(bytes.to_vec()).map_err(|_| TaskEditConflict::MarkerChanged)?;
    let opts = build_options();
    let arena = Arena::new();
    let root = parse_document(&arena, &source, &opts);
    let matches: Vec<_> = root.descendants().filter_map(|node| {
        let NodeValue::TaskItem(nti) = node.data().value else { return None; };
        let pos = nti.symbol_sourcepos;
        (pos.start.line == line && pos.start.column == column).then_some(nti)
    }).collect();
    if matches.len() != 1 { return Err(TaskEditConflict::MarkerChanged); }
    let pos = matches[0].symbol_sourcepos;
    if matches[0].symbol.is_some() == checked { return Err(TaskEditConflict::MarkerChanged); }
    let start = byte_offset_for_position(bytes, pos.start.line, pos.start.column);
    let end = byte_offset_for_position(bytes, pos.end.line, pos.end.column);
    let (Some(start), Some(end)) = (start, end) else { return Err(TaskEditConflict::MarkerChanged); };
    let Some(&marker) = bytes.get(start) else { return Err(TaskEditConflict::MarkerChanged); };
    if end != start || !matches!(marker, b' ' | b'x' | b'X') { return Err(TaskEditConflict::MarkerChanged); }
    Ok(start)
}

fn reconcile_conflict(path: &Path, reason: TaskEditConflict) -> Result<TaskEditResult, String> {
    render_markdown(path.to_path_buf())
        .map(|document| TaskEditResult::Conflict { document, reason })
        .map_err(|err| format!("checkbox reconciliation failed: {err}"))
}

#[tauri::command]
pub fn set_task_checked(
    state: tauri::State<'_, DocumentEditState>,
    path: PathBuf,
    task_line: usize,
    task_column: usize,
    expected_revision: FileRevision,
    checked: bool,
) -> Result<TaskEditResult, String> {
    set_task_checked_inner(&state, path, task_line, task_column, expected_revision, checked)
}

fn set_task_checked_inner(
    state: &DocumentEditState,
    path: PathBuf,
    task_line: usize,
    task_column: usize,
    expected_revision: FileRevision,
    checked: bool,
) -> Result<TaskEditResult, String> {
    if task_line == 0 || task_column == 0 { return Err("invalid checkbox request: task coordinates must be positive".into()); }
    validate_markdown_path(&path).map_err(|_| "invalid checkbox request: path is not Markdown".to_owned())?;
    let _guard = state.0.lock();
    let mut file = std::fs::OpenOptions::new().read(true).write(true).open(&path)
        .map_err(|err| format!("checkbox file open failed: {err}"))?;
    let initial = read_snapshot(&mut file).map_err(|err| format!("checkbox file read failed: {err}"))?;
    if initial.revision.file_id != expected_revision.file_id { return reconcile_conflict(&path, TaskEditConflict::FileReplaced); }
    if initial.revision.sha256 != expected_revision.sha256 || initial.revision.len != expected_revision.len { return reconcile_conflict(&path, TaskEditConflict::RevisionChanged); }
    let offset = match task_marker_offset(&initial.bytes, task_line, task_column, checked) {
        Ok(offset) => offset,
        Err(reason) => return reconcile_conflict(&path, reason),
    };
    let before_write = read_snapshot(&mut file).map_err(|err| format!("checkbox file read failed: {err}"))?;
    if before_write.revision.file_id != initial.revision.file_id { return reconcile_conflict(&path, TaskEditConflict::FileReplaced); }
    if before_write.revision.sha256 != initial.revision.sha256 || before_write.revision.len != initial.revision.len { return reconcile_conflict(&path, TaskEditConflict::RevisionChanged); }
    let path_metadata = std::fs::metadata(&path).map_err(|err| format!("checkbox reconciliation failed: {err}"))?;
    if file_id(&path_metadata) != initial.revision.file_id { return reconcile_conflict(&path, TaskEditConflict::FileReplaced); }
    let desired = if checked { b'x' } else { b' ' };
    if file.write_at(&[desired], offset as u64).map_err(|err| format!("checkbox write failed: {err}"))? != 1 { return Err("checkbox write failed: short write".into()); }
    file.sync_data().map_err(|err| format!("checkbox sync failed: {err}"))?;
    let after_write = read_snapshot(&mut file).map_err(|err| format!("checkbox reconciliation failed: {err}"))?;
    let mut expected_bytes = initial.bytes.clone();
    expected_bytes[offset] = desired;
    if after_write.bytes != expected_bytes { return reconcile_conflict(&path, TaskEditConflict::ConcurrentWrite); }
    let path_metadata = std::fs::metadata(&path).map_err(|err| format!("checkbox reconciliation failed: {err}"))?;
    if file_id(&path_metadata) != initial.revision.file_id { return reconcile_conflict(&path, TaskEditConflict::FileReplaced); }
    let document = render_snapshot(&path, &after_write).map_err(|err| format!("checkbox reconciliation failed: {err}"))?;
    Ok(TaskEditResult::Updated { document })
}


#[cfg(test)]
mod tests {
    use super::*;

    /// Parses `md` with the app's real options and returns the extracted
    /// headings, exercising `extract_headings` against an actual comrak AST
    /// rather than a hand-written HTML fixture.
    fn headings_for(md: &str) -> Vec<Heading> {
        let opts = build_options();
        let arena = Arena::new();
        let root = parse_document(&arena, md, &opts);
        extract_headings(root, &opts)
    }
    #[test]
    fn markdown_source_detects_line_endings_and_renders_same_snapshot() {
        let dir = std::env::temp_dir().join(format!("peekmd-source-read-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("doc.md");
        std::fs::write(&path, b"# Title\r\n\r\nbody\r\n").unwrap();
        let editable = read_markdown_source(path.clone()).unwrap();
        assert_eq!(editable.source, "# Title\r\n\r\nbody\r\n");
        assert_eq!(editable.line_separator, "\r\n");
        assert_eq!(editable.document.revision, revision_for_path(&path));
        assert!(editable.document.html.contains("<h1"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn markdown_source_save_writes_checked_inode_and_returns_revision() {
        let dir = std::env::temp_dir().join(format!("peekmd-source-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("doc.md");
        std::fs::write(&path, "before\n").unwrap();
        let editable = read_markdown_source(path.clone()).unwrap();
        let state = DocumentEditState::default();
        let result = save_markdown_source_inner(&state, path.clone(), "after\n".into(), editable.document.revision).unwrap();
        let MarkdownSaveResult::Updated { document } = result else { panic!("expected updated result"); };
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "after\n");
        assert_eq!(document.revision, revision_for_path(&path));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn markdown_source_save_conflicts_leave_external_bytes_untouched() {
        let dir = std::env::temp_dir().join(format!("peekmd-source-conflict-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("doc.md");
        std::fs::write(&path, "original\n").unwrap();
        let editable = read_markdown_source(path.clone()).unwrap();
        std::fs::write(&path, "external\n").unwrap();
        let state = DocumentEditState::default();
        let result = save_markdown_source_inner(&state, path.clone(), "local\n".into(), editable.document.revision).unwrap();
        let MarkdownSaveResult::Conflict { latest, reason } = result else { panic!("expected conflict result"); };
        assert!(matches!(reason, MarkdownSaveConflict::RevisionChanged));
        assert_eq!(latest.source, "external\n");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "external\n");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn markdown_source_save_detects_concurrent_same_inode_write() {
        let dir = std::env::temp_dir().join(format!("peekmd-source-concurrent-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("doc.md");
        std::fs::write(&path, "original\n").unwrap();
        let editable = read_markdown_source(path.clone()).unwrap();
        let state = DocumentEditState::default();
        let result = save_markdown_source_inner_with_post_write(&state, path.clone(), "local\n".into(), editable.document.revision, |canonical| std::fs::write(canonical, "external\n").unwrap()).unwrap();
        let MarkdownSaveResult::Conflict { latest, reason } = result else { panic!("expected conflict result"); };
        assert!(matches!(reason, MarkdownSaveConflict::ConcurrentWrite));
        assert_eq!(latest.source, "external\n");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "external\n");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn markdown_source_save_detects_replaced_inode() {
        let dir = std::env::temp_dir().join(format!("peekmd-source-replaced-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("doc.md");
        let replacement = dir.join("replacement.md");
        std::fs::write(&path, "original\n").unwrap();
        let editable = read_markdown_source(path.clone()).unwrap();
        std::fs::write(&replacement, "replacement\n").unwrap();
        std::fs::rename(&replacement, &path).unwrap();
        let state = DocumentEditState::default();
        let result = save_markdown_source_inner(&state, path.clone(), "local\n".into(), editable.document.revision).unwrap();
        let MarkdownSaveResult::Conflict { latest, reason } = result else { panic!("expected conflict result"); };
        assert!(matches!(reason, MarkdownSaveConflict::FileReplaced));
        assert_eq!(latest.source, "replacement\n");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn markdown_source_save_follows_symlink_without_replacing_it() {
        let dir = std::env::temp_dir().join(format!("peekmd-source-symlink-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("target.md");
        let path = dir.join("link.md");
        std::fs::write(&target, "target\n").unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        let editable = read_markdown_source(path.clone()).unwrap();
        let state = DocumentEditState::default();
        let result = save_markdown_source_inner(&state, path.clone(), "updated\n".into(), editable.document.revision).unwrap();
        assert!(matches!(result, MarkdownSaveResult::Updated { .. }));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "updated\n");
        assert!(std::fs::symlink_metadata(&path).unwrap().file_type().is_symlink());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn extract_headings_finds_all_levels_with_peekmd_ids() {
        let headings = headings_for("# Title\n\nintro\n\n## Sub Heading\n\n### Deep\n");
        assert_eq!(headings.len(), 3);
        assert_eq!(headings[0].id, "peekmd-title");
        assert_eq!(headings[0].level, 1);
        assert_eq!(headings[0].text, "Title");
        assert_eq!(headings[1].id, "peekmd-sub-heading");
        assert_eq!(headings[1].level, 2);
        assert_eq!(headings[1].text, "Sub Heading");
        assert_eq!(headings[2].id, "peekmd-deep");
        assert_eq!(headings[2].level, 3);
    }

    #[test]
    fn extract_headings_dedupes_repeated_text_like_comraks_formatter() {
        // Two headings with identical text must get distinct, formatter-
        // matching ids (anchorizer suffixes repeats with -1, -2, ...) so a
        // TOC / palette "Jump to" link can't collide with an earlier one.
        let headings = headings_for("# Notes\n\n## Notes\n");
        assert_eq!(headings[0].id, "peekmd-notes");
        assert_eq!(headings[1].id, "peekmd-notes-1");
    }

    #[test]
    fn extract_headings_strips_inline_markup_from_text() {
        let headings = headings_for("# Hello **World**\n");
        assert_eq!(headings[0].text, "Hello World");
    }

    #[test]
    fn extract_headings_returns_empty_for_no_headings() {
        assert!(headings_for("just a paragraph\n").is_empty());
        assert!(headings_for("").is_empty());
    }

    #[test]
    fn render_markdown_rejects_non_markdown_extension() {
        let err = render_markdown(PathBuf::from("/tmp/definitely-not-markdown.txt"));
        assert!(matches!(err, Err(RenderError::NotMarkdown(_))));
    }

    #[test]
    fn render_markdown_renders_gfm_and_extracts_heading() {
        let dir = std::env::temp_dir().join(format!("peekmd-render-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("doc.md");
        std::fs::write(&path, "# Hello\n\n- [x] done\n- [ ] todo\n").unwrap();

        let doc = render_markdown(path.clone()).unwrap();

        assert_eq!(doc.title, "doc");
        assert_eq!(doc.headings.len(), 1);
        assert_eq!(doc.headings[0].id, "peekmd-hello");
        assert_eq!(doc.headings[0].text, "Hello");
        assert!(doc.html.contains("checkbox"), "tasklist extension should render checkboxes: {}", doc.html);
        assert!(doc.html.contains("class=\"task-list-item\""), "task-list classes should be rendered: {}", doc.html);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    #[cfg(feature = "syntect")]
    fn renders_syntect_classes() {
        let dir = std::env::temp_dir().join(format!("peekmd-syntect-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("code.md");
        std::fs::write(&path, "```rust\nfn main() {}\n```\n").unwrap();
        let doc = render_markdown(path).unwrap();
        assert!(doc.html.contains("class=\"source rust\""), "Expected syntect CSS class in HTML, got: {}", &doc.html[..doc.html.len().min(500)]);
        std::fs::remove_dir_all(&dir).ok();
    }

    fn images_for(md: &str, md_path: &Path) -> Vec<String> {
        let opts = build_options();
        let arena = Arena::new();
        let root = parse_document(&arena, md, &opts);
        extract_local_images(root, md_path)
    }

    #[test]
    fn local_images_resolves_relative_path() {
        let dir = std::env::temp_dir().join(format!("peekmd-img-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("photo.png");
        std::fs::write(&img, b"").unwrap();
        let md_path = dir.join("doc.md");
        let imgs = images_for("![alt](photo.png)\n", &md_path);
        assert_eq!(imgs.len(), 1);
        assert_eq!(imgs[0], img.canonicalize().unwrap().to_string_lossy());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn local_images_skips_remote_and_data_urls() {
        let dir = std::env::temp_dir().join(format!("peekmd-img-skip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let md_path = dir.join("doc.md");
        let imgs = images_for(
            "![a](https://example.com/a.png) ![b](http://x.com/b.jpg) ![c](data:image/png;base64,AA==)\n",
            &md_path,
        );
        assert!(imgs.is_empty(), "remote/data URLs must be skipped: {imgs:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn local_images_deduplicates() {
        let dir = std::env::temp_dir().join(format!("peekmd-img-dedup-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("logo.png");
        std::fs::write(&img, b"").unwrap();
        let md_path = dir.join("doc.md");
        let imgs = images_for("![a](logo.png) ![b](logo.png)\n", &md_path);
        assert_eq!(imgs.len(), 1, "same image referenced twice must appear once: {imgs:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn local_images_strips_query_and_fragment() {
        let dir = std::env::temp_dir().join(format!("peekmd-img-qs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("banner.png");
        std::fs::write(&img, b"").unwrap();
        let md_path = dir.join("doc.md");
        let imgs = images_for("![x](banner.png?v=123#section)\n", &md_path);
        assert_eq!(imgs.len(), 1);
        assert_eq!(imgs[0], img.canonicalize().unwrap().to_string_lossy());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn local_images_skips_missing_files() {
        let dir = std::env::temp_dir().join(format!("peekmd-img-missing-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let md_path = dir.join("doc.md");
        let imgs = images_for("![x](does-not-exist.png)\n", &md_path);
        assert!(imgs.is_empty(), "non-existent file must be skipped: {imgs:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn render_markdown_populates_local_images() {
        let dir = std::env::temp_dir().join(format!("peekmd-img-full-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("screenshot.png");
        std::fs::write(&img, b"").unwrap();
        let md_path = dir.join("doc.md");
        std::fs::write(&md_path, "# Title\n\n![shot](screenshot.png)\n").unwrap();
        let doc = render_markdown(md_path).unwrap();
        assert_eq!(doc.local_images.len(), 1);
        assert_eq!(doc.local_images[0], img.canonicalize().unwrap().to_string_lossy());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stamp_image_srcs_appends_mtime_to_local_images() {
        let dir = std::env::temp_dir().join(format!("peekmd-stamp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("photo.png");
        std::fs::write(&img, b"px").unwrap();
        let md_path = dir.join("doc.md");
        let mut html = format!("<img src=\"photo.png\" alt=\"x\">");
        stamp_image_srcs(&mut html, &md_path);
        assert!(html.contains("?v="), "mtime stamp missing: {html}");
        assert!(!html.contains("?v=0"), "mtime should be non-zero: {html}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stamp_image_srcs_leaves_remote_urls_unchanged() {
        let md_path = Path::new("/tmp/doc.md");
        let mut html = String::from("<img src=\"https://example.com/img.png\">");
        stamp_image_srcs(&mut html, md_path);
        assert_eq!(html, "<img src=\"https://example.com/img.png\">");
    }

    #[test]
    fn render_markdown_stamps_local_image_srcs() {
        let dir = std::env::temp_dir().join(format!("peekmd-stamp-full-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("banner.png");
        std::fs::write(&img, b"px").unwrap();
        let md_path = dir.join("doc.md");
        std::fs::write(&md_path, "![banner](banner.png)\n").unwrap();
        let doc = render_markdown(md_path).unwrap();
        assert!(doc.html.contains("?v="), "rendered HTML should have mtime-stamped img src: {}", doc.html);
        std::fs::remove_dir_all(&dir).ok();
    }
    fn task_checkbox_dir(label: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("peekmd-task-{label}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        (dir.clone(), dir.join("doc.md"))
    }

    fn revision_for_path(path: &Path) -> FileRevision {
        let mut file = std::fs::File::open(path).unwrap();
        read_snapshot(&mut file).unwrap().revision
    }

    #[test]
    fn task_checkbox_rendered_inputs_are_enabled_and_identity_bearing() {
        let (dir, path) = task_checkbox_dir("render");
        std::fs::write(&path, "- [ ] parent\n  - [X] nested\n1. [x] numbered\n").unwrap();
        let doc = render_markdown(path.clone()).unwrap();
        assert!(doc.html.contains("class=\"task-list-item-checkbox\""));
        assert!(!doc.html.contains("disabled=\"\""));
        assert!(doc.html.contains("data-task-line=\"1\" data-task-column=\"4\""));
        assert!(doc.html.contains("data-task-line=\"2\" data-task-column=\"6\""));
        assert!(doc.html.contains("aria-label=\"Mark task on line 1 complete\""));
        assert!(doc.html.contains("aria-label=\"Mark task on line 2 incomplete\""));
        assert!(doc.html.contains("data-sourcepos=\"1:1-2:14\""));
        assert!(doc.html.contains("data-sourcepos=\"2:3-2:14\""));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn task_checkbox_raw_and_lookalike_markers_are_not_generated_tasks() {
        let (dir, path) = task_checkbox_dir("raw");
        std::fs::write(&path, "- [!] no\n```\n- [ ] fence\n```\n<input type=\"checkbox\"> raw\n").unwrap();
        let doc = render_markdown(path.clone()).unwrap();
        assert_eq!(doc.html.matches("data-task-line=").count(), 0);
        assert!(doc.html.contains("<input type=\"checkbox\">") && doc.html.contains("raw"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn task_checkbox_updates_exactly_one_byte_and_preserves_uppercase_until_unchecked() {
        let (dir, path) = task_checkbox_dir("write");
        std::fs::write(&path, "before\n- [X] keep case\n- [ ] check\nafter\n").unwrap();
        let state = DocumentEditState::default();
        let revision = revision_for_path(&path);
        let updated = set_task_checked_inner(&state, path.clone(), 3, 4, revision, true).unwrap();
        assert!(matches!(updated, TaskEditResult::Updated { .. }));
        let checked = std::fs::read(&path).unwrap();
        assert_eq!(&checked, b"before\n- [X] keep case\n- [x] check\nafter\n");
        let revision = revision_for_path(&path);
        let updated = set_task_checked_inner(&state, path.clone(), 2, 4, revision, false).unwrap();
        assert!(matches!(updated, TaskEditResult::Updated { .. }));
        assert_eq!(std::fs::read(&path).unwrap(), b"before\n- [ ] keep case\n- [x] check\nafter\n");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn task_checkbox_offsets_handle_bom_unicode_tabs_and_line_endings() {
        let cases = [
            (b"\xEF\xBB\xBF- [ ] bom\r\n- [x] crlf\r- [ ] cr\n".as_slice(), 1, 4),
            ("é - [ ] unicode\n\t- [ ] tab\n".as_bytes(), 1, 7),
            (b"- [ ] no newline".as_slice(), 1, 4),
        ];
        for (bytes, line, column) in cases {
            let offset = byte_offset_for_position(bytes, line, column).unwrap();
            assert_eq!(bytes[offset], b' ');
        }
        let tab = b"\t- [ ] tab";
        assert_eq!(byte_offset_for_position(tab, 1, 8).map(|n| tab[n]), Some(b' '));
        let crlf = b"- [ ] one\r\n- [ ] two\r- [ ] three";
        assert_eq!(byte_offset_for_position(crlf, 2, 4).map(|n| crlf[n]), Some(b' '));
        assert_eq!(byte_offset_for_position(crlf, 3, 4).map(|n| crlf[n]), Some(b' '));
    }

    #[test]
    fn task_checkbox_stale_revision_and_invalid_requests_do_not_write() {
        let (dir, path) = task_checkbox_dir("conflict");
        std::fs::write(&path, "- [ ] task\n").unwrap();
        let state = DocumentEditState::default();
        let revision = revision_for_path(&path);
        std::fs::write(&path, "- [x] task\n").unwrap();
        let result = set_task_checked_inner(&state, path.clone(), 1, 4, revision, true).unwrap();
        assert!(matches!(result, TaskEditResult::Conflict { reason: TaskEditConflict::RevisionChanged, .. }));
        assert_eq!(std::fs::read(&path).unwrap(), b"- [x] task\n");
        let result = set_task_checked_inner(&state, path.clone(), 0, 4, revision_for_path(&path), false);
        assert!(matches!(result, Err(ref err) if err.starts_with("invalid checkbox request:")));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn task_checkbox_nested_duplicate_labels_map_by_coordinates() {
        let (dir, path) = task_checkbox_dir("duplicate");
        std::fs::write(&path, "- [ ] same\n  - [ ] same\n- [ ] same\n").unwrap();
        let doc = render_markdown(path.clone()).unwrap();
        assert!(doc.html.contains("data-task-line=\"1\" data-task-column=\"4\""));
        assert!(doc.html.contains("data-task-line=\"2\" data-task-column=\"6\""));
        assert!(doc.html.contains("data-task-line=\"3\" data-task-column=\"4\""));
        let state = DocumentEditState::default();
        let updated = set_task_checked_inner(&state, path.clone(), 2, 6, doc.revision, true).unwrap();
        assert!(matches!(updated, TaskEditResult::Updated { .. }));
        assert_eq!(std::fs::read(&path).unwrap(), b"- [ ] same\n  - [x] same\n- [ ] same\n");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn task_checkbox_symlink_target_changes_without_replacing_link() {
        let (dir, path) = task_checkbox_dir("symlink");
        let target = dir.join("target.md");
        std::fs::write(&target, "- [ ] target\n").unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        let revision = revision_for_path(&path);
        let state = DocumentEditState::default();
        let result = set_task_checked_inner(&state, path.clone(), 1, 4, revision, true).unwrap();
        assert!(matches!(result, TaskEditResult::Updated { .. }));
        assert_eq!(std::fs::read(&target).unwrap(), b"- [x] target\n");
        assert!(std::fs::symlink_metadata(&path).unwrap().file_type().is_symlink());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn task_checkbox_replaced_path_returns_conflict_without_touching_replacement() {
        let (dir, path) = task_checkbox_dir("replaced");
        let replacement = dir.join("replacement.md");
        std::fs::write(&path, "- [ ] original\n").unwrap();
        let revision = revision_for_path(&path);
        std::fs::write(&replacement, "- [ ] replacement\n").unwrap();
        std::fs::rename(&replacement, &path).unwrap();
        let state = DocumentEditState::default();
        let result = set_task_checked_inner(&state, path.clone(), 1, 4, revision, true).unwrap();
        assert!(matches!(result, TaskEditResult::Conflict { reason: TaskEditConflict::FileReplaced, .. }));
        assert_eq!(std::fs::read(&path).unwrap(), b"- [ ] replacement\n");
        std::fs::remove_dir_all(dir).ok();
    }


}
