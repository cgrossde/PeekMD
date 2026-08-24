export function formatHome(path: string): string {
  const match = path.match(/^\/Users\/[^/]+/);
  if (match) return '~' + path.slice(match[0].length);
  return path;
}

// Not exported — only stemName needs it, and nothing outside this file
// imports it, so it stays a private helper rather than public API surface.
function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

export function stemName(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Immediate parent directory name of a path, e.g. "/a/PeekMD/README.md" -> "PeekMD". Empty string if there is no parent segment. */
export function parentFolder(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments.length >= 2 ? segments[segments.length - 2] : '';
}
