import { revealItemInDir } from '@tauri-apps/plugin-opener';

/** Reveal a file in Finder via the opener plugin (`opener:allow-reveal-item-in-dir`). */
export function revealInFinder(path: string): Promise<void> {
  return revealItemInDir(path);
}
