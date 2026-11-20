import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * comrak emits <img src="..."> verbatim from the Markdown source — there is
 * no server-side rewriting. A relative path like `./img/shot.png` (or an
 * absolute filesystem path, or a `file://` URI) is meaningless to the
 * webview, whose origin is the app bundle, not the document's folder. This
 * rewrites those into URLs loadable via Tauri's asset protocol (see
 * `app.security.assetProtocol` in `tauri.conf.json`).
 */
export function resolveMarkdownImages(container: HTMLElement, docPath: string): void {
  const dir = dirname(docPath);
  container.querySelectorAll<HTMLImageElement>('img[src]').forEach(img => {
    const raw = img.getAttribute('src');
    if (raw) img.setAttribute('src', resolveSrc(dir, raw));
  });
  // <picture><source srcset> and <img srcset>: the browser prefers these over
  // the <img src> fallback, so an unresolved candidate breaks the image.
  container.querySelectorAll<HTMLElement>('source[srcset], img[srcset]').forEach(el => {
    const raw = el.getAttribute('srcset');
    if (raw) el.setAttribute('srcset', resolveSrcset(dir, raw));
  });
}

/** Resolves one image URL; remote, data and already-resolved URLs pass through. */
function resolveSrc(dir: string, raw: string): string {
  if (isAlreadyLoadable(raw)) return raw;
  try {
    // Split off ?v=<mtime> query that Rust stamps onto local image srcs.
    // We need to resolve only the path part, then re-attach the query to
    // the final asset:// URL so WKWebView sees a distinct URL each time
    // the image changes on disk.
    const qIdx = raw.indexOf('?');
    const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
    const query = qIdx >= 0 ? raw.slice(qIdx) : '';
    const fsPath = pathPart.startsWith('file://')
      ? decodeURIComponent(pathPart.slice('file://'.length))
      : resolvePath(dir, pathPart);
    return convertFileSrc(fsPath) + query;
  } catch {
    /* leave the original src — a broken-image icon beats a thrown error */
    return raw;
  }
}

/** Resolves each candidate of a srcset (`url [descriptor], ...`). */
function resolveSrcset(dir: string, srcset: string): string {
  return srcset
    .split(/,\s+|,$/)
    .map(candidate => candidate.trim())
    .filter(Boolean)
    .map(candidate => {
      const [url, ...descriptor] = candidate.split(/\s+/);
      return [resolveSrc(dir, url), ...descriptor].join(' ');
    })
    .join(', ');
}

function isAlreadyLoadable(src: string): boolean {
  return /^(https?:|data:|blob:|asset:)/i.test(src);
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

/** Resolves `href` (relative or absolute) against `dir`, collapsing `.`/`..`. */
function resolvePath(dir: string, href: string): string {
  if (href.startsWith('/')) return href;
  const parts = dir.split('/').filter(Boolean);
  for (const part of href.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
}
