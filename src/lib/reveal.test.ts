import { describe, expect, it, vi } from 'vitest';

const { revealItemInDir } = vi.hoisted(() => ({ revealItemInDir: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir }));

import { revealInFinder } from './reveal';

describe('revealInFinder', () => {
  it('reveals the given path through the opener plugin', async () => {
    await revealInFinder('/tmp/a.md');
    expect(revealItemInDir).toHaveBeenCalledWith('/tmp/a.md');
  });
});
