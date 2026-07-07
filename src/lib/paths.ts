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

/**
 * Returns a short directory qualifier to display after the filename when
 * multiple open docs share the same stem name, e.g. "(PeekMD)" or "(projects/PeekMD)".
 *
 * Algorithm:
 *   1. If this path's stem is unique among `allPaths`, return null.
 *   2. Otherwise, collect the other paths that share the same stem.
 *   3. Walk up parent segments one at a time (1, then 2, …) until the
 *      resulting suffix is unique among all duplicates.
 *   4. Return that suffix wrapped in parens.
 *
 * Only the paths that share the same stem name participate in the depth
 * calculation — unrelated paths are ignored.
 */
export function disambiguator(allPaths: string[], path: string): string | null {
  const stem = stemName(path);
  const dupes = allPaths.filter(p => stemName(p) === stem);
  if (dupes.length <= 1) return null;

  const segments = (p: string) => p.split('/').slice(0, -1); // parent segments

  for (let depth = 1; ; depth++) {
    const suffix = (p: string) => segments(p).slice(-depth).join('/');
    const mine = suffix(path);
    // Unique if no other duplicate shares the same suffix at this depth.
    const isUnique = dupes.filter(p => p !== path).every(p => suffix(p) !== mine);
    if (isUnique) return `(${mine})`;
    // Safety: cap at total segment count to avoid infinite loop on identical paths.
    if (depth >= segments(path).length) return `(${mine})`;
  }
}
