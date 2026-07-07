use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;
use comrak::{format_html_with_plugins, options, parse_document, Anchorizer, Arena, Options};
use comrak::html::collect_text;
use comrak::nodes::{AstNode, NodeValue};
use comrak::plugins::syntect::SyntectAdapter;

#[derive(serde::Serialize, Clone)]
pub struct Heading {
    pub id: String,
    pub level: u8,
    pub text: String,
}

#[derive(serde::Serialize, Clone)]
pub struct RenderedDoc {
    pub html: String,
    pub title: String,
    pub path: String,
    pub headings: Vec<Heading>,
    pub mtime: u64,
    /// Absolute paths of local images referenced by the document.
    /// Used by the watcher to re-render when an image file changes.
    pub local_images: Vec<String>,
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

#[tauri::command]
pub fn render_markdown(path: PathBuf) -> Result<RenderedDoc, RenderError> {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "md" | "markdown" | "mdown" | "mkd") {
        return Err(RenderError::NotMarkdown(
            path.to_string_lossy().into_owned(),
        ));
    }
    let source = std::fs::read_to_string(&path)?;
    let opts = build_options();
    let start = std::time::Instant::now();
    let mut plugins = options::Plugins::default();
    plugins.render.codefence_syntax_highlighter = Some(syntect_adapter());

    // Parse once into an AST and reuse it for both heading extraction and
    // HTML formatting, rather than re-scanning the rendered HTML string for
    // headings after the fact.
    let arena = Arena::new();
    let root = parse_document(&arena, &source, &opts);
    let headings = extract_headings(root, &opts);
    let local_images = extract_local_images(root, &path);
    let mut html = String::new();
    // Writing into an in-memory String via fmt::Write is infallible in
    // practice; comrak's own `markdown_to_html_with_plugins` does the same
    // `.unwrap()` internally.
    format_html_with_plugins(root, &opts, &mut html, &plugins)
        .expect("formatting HTML into an in-memory buffer should never fail");
    stamp_image_srcs(&mut html, &path);

    tracing::info!(
        target: "peekmd::render",
        path = %path.display(),
        bytes = source.len(),
        took_ms = start.elapsed().as_millis() as u64,
        "rendered"
    );
    let mtime = std::fs::metadata(&path)
        .and_then(|m| m.modified())
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
        local_images,
    })
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
}
