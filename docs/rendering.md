# Rendering

PeekMD renders Markdown to HTML in Rust using `comrak 0.52` and returns the result to the frontend as a `RenderedDoc`. All rendering is on-demand — the backend never pushes HTML unsolicited.

**Source:** `src-tauri/src/render.rs`.

## comrak configuration

```rust
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
    // Comrak extras
    opts.extension.superscript = true;
    opts.extension.subscript = true;
    opts.extension.highlight = true;
    opts.extension.insert = true;
    opts.extension.underline = true;
    opts.extension.multiline_block_quotes = true;
    opts.extension.front_matter_delimiter = Some("---".into());
    opts.extension.header_id_prefix = Some("peekmd-".into());
    opts.render.sourcepos = true;
    opts.render.r#unsafe = true;
    opts
}
```

### `unsafe` + `tagfilter`

`tagfilter` has **no effect** while `render.unsafe` is `false` — comrak replaces all raw HTML with `<!-- raw HTML omitted -->` regardless of `tagfilter` in that mode, so the two must be enabled together. PeekMD sets `unsafe = true` specifically so `tagfilter` can do its job: real-world Markdown (GitHub READMEs especially) commonly relies on raw HTML — `<details>`/`<summary>`, `<br>`, `<img align="right">`, badge `<picture>` blocks — and none of that rendered under the old `unsafe = false` configuration.

`tagfilter` blocklists tag *names* only (`<script>`, `<iframe>`, `<style>`, `<title>`, `<textarea>`, `<xmp>`, `<noembed>`, `<noframes>`, `<plaintext>` are escaped). It does **not** sanitize dangerous attributes on otherwise-allowed tags (`<img onerror="...">`, `<a href="javascript:...">`) or dangerous link schemes, which `unsafe = true` also re-enables. The `security.csp` block in `tauri.conf.json` (`script-src: 'self'`, no `'unsafe-inline'`) is the actual backstop against that residual class of injection — it blocks inline `<script>` tags and inline event-handler attributes at the WebView level regardless of what slips through comrak. See [ipc.md](ipc.md#capabilities) for the full CSP.

### Enabled extensions

| Extension | Syntax | Notes |
| --- | --- | --- |
| `table` | GFM pipe tables | |
| `tasklist` | `- [x]` / `- [ ]` | |
| `strikethrough` | `~~text~~` | |
| `autolink` | Bare URLs | |
| `footnotes` | `[^1]` reference style | |
| `inline_footnotes` | `^[inline text]` | |
| `tagfilter` | Blocks `<script>`, `<iframe>`, etc. | Only takes effect because `render.unsafe = true` (see below) — HTML is kept but sanitised per GFM spec |
| `alerts` | `> [!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!IMPORTANT]`, `[!CAUTION]` | GitHub-style callout blocks |
| `superscript` | `e^2^` | |
| `subscript` | `H~2~O` | Overrides single-tilde strikethrough |
| `highlight` | `==mark==` | Emits `<mark>` |
| `insert` | `++ins++` | Emits `<ins>` |
| `underline` | `__underline__` | Replaces bold for `__` syntax |
| `multiline_block_quotes` | `>>>` fenced blockquotes | |
| `front_matter_delimiter` | `---` YAML front matter | Stripped silently; not rendered |
| `header_id_prefix` | — | All heading ids prefixed with `peekmd-` |

### Not enabled

| Extension | Reason |
| --- | --- |
| `description_lists` | Incompatible with `render.sourcepos` per comrak source notes — would break scroll-to-change |
| `math_dollars` / `math_code` | Deferred to Phase 3; comrak emits `<span data-math-style>` but no renderer is wired |
| `wikilinks_*` | Non-standard syntax; no v1 demand |
| `shortcodes` | Requires the `shortcodes` cargo feature and emoji data; binary size cost |
| `greentext` | Alters blockquote semantics in ways that break standard Markdown |
| `spoiler` / `subtext` / `cjk_friendly_emphasis` | Niche; can be added without API changes later |

## sourcepos and scroll-to-change

`opts.render.sourcepos = true` instructs comrak to emit a `data-sourcepos="startLine:startCol-endLine:endCol"` attribute on every block-level HTML element. For example:

```html
<p data-sourcepos="3:1-5:10">Hello world</p>
<h2 id="peekmd-overview" data-sourcepos="7:1-7:15">Overview</h2>
```

This attribute is the foundation of the scroll-to-change algorithm in `src/lib/scrollToChange.ts`. After a re-render, the algorithm compares top-level elements by their `data-sourcepos` and `textContent`. A changed `data-sourcepos` means lines shifted (e.g., a paragraph was inserted above); changed `textContent` with the same `data-sourcepos` means the block was edited in place. The first diverging element is the scroll target.

The comparison is purely DOM-level — no second Rust pass, no source line map. The `data-sourcepos` attribute carries the mapping from the single comrak invocation.

## Images

comrak emits `<img src="...">` verbatim from the Markdown source. A relative path (`./img/shot.png`), an absolute filesystem path, or a `file://` URI is meaningless to the WebView, whose origin is the app bundle — not the folder the open document lives in. There is no Rust-side rewriting of image URLs; instead, `src/lib/mdImages.ts` (`resolveMarkdownImages(container, docPath)`) walks every `<img>` in the rendered DOM after each render (initial open, doc switch, and every live-reload re-render — wired via a `useLayoutEffect` on `activeDoc.path`/`activeDoc.html` in `App.tsx`) and rewrites any src that isn't already loadable (`http(s):`, `data:`, `blob:`, `asset:` are left untouched) into a `convertFileSrc`-generated URL, resolved against `docPath`'s directory.

This requires Tauri's asset protocol, configured in `tauri.conf.json`:

```json
"security": {
  "assetProtocol": { "enable": true, "scope": ["$HOME/**/*"] }
}
```

Files opened from outside `$HOME` (e.g. `/tmp`, an external volume) can still be opened and read as the primary document, but images referenced from such a file will not load — the asset protocol scope only covers `$HOME`. This mirrors the scope PeekMD used to grant via the (now-removed) `fs:scope-home-recursive` capability and is a deliberate trade-off between covering the overwhelmingly common case and keeping the asset-protocol scope from being unbounded.

Remote `http(s)` images are deliberately **not** proxied or fetched specially — the CSP's `img-src` only allows `'self' asset: http://asset.localhost data:`, so a remote image reference simply won't load. This is intentional: the SPEC's acceptance criteria require zero network calls at runtime, and silently fetching remote images would violate that.

## Heading extraction

`extract_headings(html: &str) -> Vec<Heading>` is a manual HTML scanner, not a regex. It walks the HTML byte by byte, identifies `<h1>`..`<h6>` opening tags, extracts the `id` attribute (which comrak has already set to `peekmd-{slug}`), finds the matching close tag, and strips HTML from the inner content via `strip_tags`.

```rust
pub struct Heading {
    pub id: String,    // e.g. "peekmd-getting-started"
    pub level: u8,     // 1–6
    pub text: String,  // plain text, HTML tags stripped
}
```

`strip_tags` is a simple character-level scanner — not a regex dependency — that removes anything between `<` and `>`:

```rust
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}
```

Headings are used by the TOC component (`src/components/TOC.tsx`) to render the right-rail navigation and by the command palette for "Jump to: \<heading\>" items. Only H2 and H3 appear in the TOC rail; the palette surfaces up to H3.

## RenderedDoc

The `render_markdown` Tauri command returns:

```rust
pub struct RenderedDoc {
    pub html: String,         // full rendered HTML body
    pub title: String,        // file stem without extension
    pub path: String,         // absolute path, as passed in
    pub headings: Vec<Heading>,
    pub mtime: u64,           // modification time, Unix seconds
}
```

`mtime` is read from `std::fs::metadata(&path).modified()` after rendering. It is used by the frontend to detect whether a `file-changed` event carries a newer mtime than the currently rendered version.

`title` is the file stem (e.g., `README` for `README.md`) derived from `path.file_stem()`. There is no front-matter title extraction — PeekMD strips front matter but does not parse it.

## Error handling

`render_markdown` returns `Result<RenderedDoc, RenderError>`:

```rust
pub enum RenderError {
    Io(#[from] std::io::Error),       // file unreadable
    NotMarkdown(String),               // extension not in {md, markdown, mdown, mkd}
    Stat(String),                      // fs::metadata failed after a successful read
}
```

`RenderError` implements `serde::Serialize` so Tauri serialises it to the frontend as a string. The frontend (`store.ts` `openMany`) catches the error and surfaces it via `lastError`.

## Logging

Each invocation logs at `INFO` level via `tracing`:

```rust
tracing::info!(
    target: "peekmd::render",
    path = %path.display(),
    bytes = source.len(),
    took_ms = start.elapsed().as_millis() as u64,
    "rendered"
);
```

Log files are written by `tracing-appender` to `~/Library/Logs/PeekMD/`.
