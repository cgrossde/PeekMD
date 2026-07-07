import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Persisted } from './lib/persistence';

const rendered = new Map<string, { html: string; title: string; headings: never[] }>();
function seed(path: string, html = `<p>${path}</p>`) {
  rendered.set(path, { html, title: path.split('/').pop()!.replace(/\.md$/, ''), headings: [] });
}

const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === 'render_markdown') {
    const path = args!.path as string;
    const doc = rendered.get(path);
    if (!doc) throw new Error(`ENOENT: ${path}`);
    return { html: doc.html, title: doc.title, path, headings: doc.headings, mtime: 0, local_images: [] };
  }
  if (cmd === 'watch_paths' || cmd === 'unwatch' || cmd === 'watch_images' || cmd === 'unwatch_images') return undefined;
  throw new Error(`unexpected invoke: ${cmd}`);
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: [string, Record<string, unknown>?]) => invoke(...a) }));

const loadState = vi.fn<() => Promise<Persisted | null>>();
vi.mock('./lib/persistence', () => ({ loadState: (...a: []) => loadState(...a) }));

const { useStore } = await import('./store');

const initialState = useStore.getState();

beforeEach(() => {
  useStore.setState(initialState, true);
  invoke.mockClear();
  loadState.mockReset();
  rendered.clear();
  seed('/docs/a.md');
  seed('/docs/b.md');
  seed('/docs/c.md');
});

describe('navigation history', () => {
  it('pushes the previous doc onto navBack when switching documents', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');
    expect(useStore.getState().navBack).toEqual(['/docs/a.md']);
    expect(useStore.getState().activeDocId).toBe('/docs/b.md');
  });

  it('navigateBack/navigateForward move activeDocId and swap the stacks', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');
    useStore.getState().navigateBack();
    expect(useStore.getState().activeDocId).toBe('/docs/a.md');
    expect(useStore.getState().navBack).toEqual([]);
    expect(useStore.getState().navForward).toEqual(['/docs/b.md']);

    useStore.getState().navigateForward();
    expect(useStore.getState().activeDocId).toBe('/docs/b.md');
    expect(useStore.getState().navForward).toEqual([]);
    expect(useStore.getState().navBack).toEqual(['/docs/a.md']);
  });

  it('does not push history when activate is called with pushHistory: false', async () => {
    await useStore.getState().openFile('/docs/a.md');
    useStore.getState().activate('/docs/a.md', { pushHistory: false });
    expect(useStore.getState().navBack).toEqual([]);
  });

  // Regression test: hydrateFromDisk used to call openFile without suppressing
  // history, so restoring N docs left N-1 stale entries in navBack and the
  // back/forward buttons appeared immediately after every relaunch — directly
  // contradicting the SPEC ("history... resets on launch").
  it('hydrateFromDisk restores multiple open docs without polluting nav history', async () => {
    loadState.mockResolvedValue({
      version: 2,
      openDocs: ['/docs/a.md', '/docs/b.md', '/docs/c.md'],
      activeDoc: '/docs/c.md',
      rightPaneDoc: null,
      recentlyClosed: [],
      scrollPositions: {},
      ui: { sidebarVisible: true, tocVisible: true, themeOverride: null },
    });

    await useStore.getState().hydrateFromDisk();

    expect(useStore.getState().openDocs.map(d => d.path)).toEqual(['/docs/a.md', '/docs/b.md', '/docs/c.md']);
    expect(useStore.getState().activeDocId).toBe('/docs/c.md');
    expect(useStore.getState().navBack).toEqual([]);
    expect(useStore.getState().navForward).toEqual([]);
  });

  it('hydrateFromDisk drops missing files silently and still leaves clean history', async () => {
    loadState.mockResolvedValue({
      version: 2,
      openDocs: ['/docs/a.md', '/docs/missing.md', '/docs/b.md'],
      activeDoc: '/docs/b.md',
      rightPaneDoc: null,
      recentlyClosed: [],
      scrollPositions: {},
      ui: { sidebarVisible: true, tocVisible: true, themeOverride: null },
    });

    await useStore.getState().hydrateFromDisk();

    expect(useStore.getState().openDocs.map(d => d.path)).toEqual(['/docs/a.md', '/docs/b.md']);
    expect(useStore.getState().navBack).toEqual([]);
  });
});

describe('close / closeOthers', () => {
  it('activates the next doc in the list when closing the active middle doc', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');
    await useStore.getState().openFile('/docs/c.md');
    useStore.getState().activate('/docs/b.md');

    useStore.getState().close('/docs/b.md');

    expect(useStore.getState().openDocs.map(d => d.path)).toEqual(['/docs/a.md', '/docs/c.md']);
    expect(useStore.getState().activeDocId).toBe('/docs/c.md');
  });

  it('falls back to the previous doc when closing the last (active) doc', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');

    useStore.getState().close('/docs/b.md');

    expect(useStore.getState().activeDocId).toBe('/docs/a.md');
  });

  it('prepends the closed doc to recentlyClosed and prunes it from history', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');

    useStore.getState().close('/docs/a.md');

    const recent = useStore.getState().recentlyClosed;
    expect(recent[0].path).toBe('/docs/a.md');
    expect(useStore.getState().navBack).not.toContain('/docs/a.md');
  });

  it('caps recentlyClosed at 20 entries, newest first', async () => {
    for (let i = 0; i < 25; i++) {
      seed(`/docs/gen-${i}.md`);
      await useStore.getState().openFile(`/docs/gen-${i}.md`);
      useStore.getState().close(`/docs/gen-${i}.md`);
    }
    const recent = useStore.getState().recentlyClosed;
    expect(recent).toHaveLength(20);
    expect(recent[0].path).toBe('/docs/gen-24.md');
  });

  it('closeOthers closes every doc except the given one', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');
    await useStore.getState().openFile('/docs/c.md');

    useStore.getState().closeOthers('/docs/b.md');

    expect(useStore.getState().openDocs.map(d => d.path)).toEqual(['/docs/b.md']);
  });
});

describe('markDirty', () => {
  it('re-renders immediately when the changed doc is active, and clears dirty', async () => {
    await useStore.getState().openFile('/docs/a.md');
    seed('/docs/a.md', '<p>updated</p>');

    await useStore.getState().markDirty('/docs/a.md', 123);

    const doc = useStore.getState().openDocs.find(d => d.path === '/docs/a.md')!;
    expect(doc.html).toBe('<p>updated</p>');
    expect(doc.dirty).toBe(false);
    expect(invoke).toHaveBeenCalledWith('render_markdown', { path: '/docs/a.md' });
  });

  it('only flags dirty (no re-render) when the changed doc is inactive', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md'); // b is now active
    invoke.mockClear();

    await useStore.getState().markDirty('/docs/a.md', 456);

    const doc = useStore.getState().openDocs.find(d => d.path === '/docs/a.md')!;
    expect(doc.dirty).toBe(true);
    expect(doc.mtime).toBe(456);
    expect(invoke).not.toHaveBeenCalledWith('render_markdown', { path: '/docs/a.md' });
  });
});

describe('activate', () => {
  // Regression test: a doc that changed on disk while it was in the
  // background used to just have its `dirty` flag cleared on activation —
  // the stale, pre-change `html` stayed on screen until something else
  // (e.g. another file-changed event, or ⌘R) happened to re-render it.
  it('re-renders a doc that went dirty in the background once it becomes active', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md'); // b is now active
    seed('/docs/a.md', '<p>updated on disk</p>');
    await useStore.getState().markDirty('/docs/a.md', 999); // flags dirty, html still stale
    invoke.mockClear();

    useStore.getState().activate('/docs/a.md');

    await vi.waitFor(() => {
      expect(useStore.getState().openDocs.find(d => d.path === '/docs/a.md')?.html).toBe('<p>updated on disk</p>');
    });
    const doc = useStore.getState().openDocs.find(d => d.path === '/docs/a.md')!;
    expect(doc.dirty).toBe(false);
    expect(invoke).toHaveBeenCalledWith('render_markdown', { path: '/docs/a.md' });
  });

  it('does not re-render a doc that was already clean when activated', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');
    invoke.mockClear();

    useStore.getState().activate('/docs/a.md');
    await Promise.resolve();

    expect(invoke).not.toHaveBeenCalledWith('render_markdown', expect.anything());
  });
});

describe('toggleTheme', () => {
  it('flips ui.themeOverride', () => {
    expect(useStore.getState().ui.themeOverride).toBeNull();
    useStore.getState().toggleTheme();
    const first = useStore.getState().ui.themeOverride;
    expect(first === 'light' || first === 'dark').toBe(true);
    useStore.getState().toggleTheme();
    expect(useStore.getState().ui.themeOverride).not.toBe(first);
  });
});
