import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Text } from '@codemirror/state';
import type { Persisted } from './lib/persistence';

const defaultRevision = { sha256: 'seed', len: 0, file_id: 'seed:1' };
const rendered = new Map<string, { html: string; title: string; headings: never[]; revision: typeof defaultRevision; meta: null; local_images: string[] }>();
const sources = new Map<string, string>();
function seed(path: string, html = `<p>${path}</p>`, revision = defaultRevision) {
  rendered.set(path, { html, title: path.split('/').pop()!.replace(/\.md$/, ''), headings: [], revision, meta: null, local_images: [] });
  sources.set(path, `# ${path}\n`);
}
let taskResponse: unknown = null;
let taskFailure: Error | null = null;
let saveResponses: unknown[] = [];

const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === 'render_markdown') {
    const path = args!.path as string;
    const doc = rendered.get(path);
    if (!doc) throw new Error(`ENOENT: ${path}`);
    return { html: doc.html, title: doc.title, path, headings: doc.headings, mtime: 0, revision: doc.revision, meta: doc.meta, local_images: doc.local_images };
  }
  if (cmd === 'read_markdown_source') {
    const path = args!.path as string;
    const doc = rendered.get(path);
    if (!doc) throw new Error(`ENOENT: ${path}`);
    return { source: sources.get(path) ?? '', line_separator: '\n', document: { ...doc, path, mtime: 0 } };
  }
  if (cmd === 'save_markdown_source') {
    const response = saveResponses.shift();
    if (response instanceof Promise) return response;
    if (response) return response;
    const path = args!.path as string;
    const doc = rendered.get(path)!;
    sources.set(path, args!.source as string);
    return { status: 'updated', document: { ...doc, path, mtime: 0 } };
  }
  if (cmd === 'set_task_checked') {
    if (taskFailure) throw taskFailure;
    return taskResponse;
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
  sources.clear();
  saveResponses = [];
  seed('/docs/a.md');
  seed('/docs/b.md');
  taskResponse = null;
  taskFailure = null;
  seed('/docs/c.md');
});

afterEach(() => vi.useRealTimers());

describe('document opening order', () => {
  it('adds newly opened documents to the front of the open document list', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');
    await useStore.getState().openFile('/docs/c.md');

    expect(useStore.getState().openDocs.map(d => d.path)).toEqual(['/docs/c.md', '/docs/b.md', '/docs/a.md']);
  });
  it('moves the oldest eligible documents to recently viewed at the open limit', async () => {
    const openedAt = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < 11; i++) {
      const path = `/docs/old-${i}.md`;
      seed(path);
      await useStore.getState().openFile(path, { openedAt, activate: false, prune: false });
    }

    useStore.getState().pruneOpenDocuments();

    expect(useStore.getState().openDocs).toHaveLength(10);
    expect(useStore.getState().openDocs[0].path).toBe('/docs/old-10.md');
    expect(useStore.getState().recentlyViewed[0].path).toBe('/docs/old-0.md');
  });

  it('keeps more than ten documents when the excess documents are too new', async () => {
    for (let i = 0; i < 11; i++) {
      const path = `/docs/new-${i}.md`;
      seed(path);
      await useStore.getState().openFile(path, { activate: false, prune: false });
    }

    useStore.getState().pruneOpenDocuments();

    expect(useStore.getState().openDocs).toHaveLength(11);
    expect(useStore.getState().recentlyViewed).toHaveLength(0);
  });

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
    await useStore.getState().navigateBack();
    expect(useStore.getState().activeDocId).toBe('/docs/a.md');
    expect(useStore.getState().navBack).toEqual([]);
    expect(useStore.getState().navForward).toEqual(['/docs/b.md']);

    await useStore.getState().navigateForward();
    expect(useStore.getState().activeDocId).toBe('/docs/b.md');
    expect(useStore.getState().navForward).toEqual([]);
    expect(useStore.getState().navBack).toEqual(['/docs/a.md']);
  });

  it('does not push history when activate is called with pushHistory: false', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().activate('/docs/a.md', { pushHistory: false });
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
      openedAt: {},
      activeDoc: '/docs/c.md',
      rightPaneDoc: null,
      recentlyViewed: [],
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
      openedAt: {},
      activeDoc: '/docs/b.md',
      rightPaneDoc: null,
      recentlyViewed: [],
      scrollPositions: {},
      ui: { sidebarVisible: true, tocVisible: true, themeOverride: null },
    });

    await useStore.getState().hydrateFromDisk();

    expect(useStore.getState().openDocs.map(d => d.path)).toEqual(['/docs/a.md', '/docs/b.md']);
    expect(useStore.getState().navBack).toEqual([]);
  });

  // Regression test: on cold launch, a file opened explicitly (CLI arg / Finder /
  // open-files) races hydrateFromDisk. Hydration restoring the persisted active
  // doc must NOT steal focus from the explicitly opened file, which appeared in
  // the sidebar but was left unfocused.
  it('hydrateFromDisk does not override a file opened explicitly this launch', async () => {
    loadState.mockResolvedValue({
      version: 2,
      openDocs: ['/docs/a.md', '/docs/b.md'],
      openedAt: {},
      activeDoc: '/docs/b.md',
      rightPaneDoc: null,
      recentlyViewed: [],
      scrollPositions: {},
      ui: { sidebarVisible: true, tocVisible: true, themeOverride: null },
    });
    seed('/docs/cli.md');

    // Explicit open lands first (the CLI-passed file), then hydration runs.
    await useStore.getState().openFile('/docs/cli.md');
    await useStore.getState().hydrateFromDisk();

    expect(useStore.getState().activeDocId).toBe('/docs/cli.md');
    expect(useStore.getState().openDocs.map(d => d.path)).toEqual(['/docs/cli.md', '/docs/a.md', '/docs/b.md']);
  });
});

describe('close / closeOthers', () => {
  it('activates the next doc in the list when closing the active middle doc', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');
    await useStore.getState().openFile('/docs/c.md');
    await useStore.getState().activate('/docs/b.md');

    await useStore.getState().close('/docs/b.md');

    expect(useStore.getState().openDocs.map(d => d.path)).toEqual(['/docs/c.md', '/docs/a.md']);
    expect(useStore.getState().activeDocId).toBe('/docs/a.md');
  });

  it('falls back to the previous doc when closing the last (active) doc', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');

    await useStore.getState().close('/docs/b.md');

    expect(useStore.getState().activeDocId).toBe('/docs/a.md');
  });

  it('prepends the viewed doc to recentlyViewed and prunes it from history', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');

    await useStore.getState().close('/docs/a.md');

    const recent = useStore.getState().recentlyViewed;
    expect(recent[0].path).toBe('/docs/a.md');
    expect(useStore.getState().navBack).not.toContain('/docs/a.md');
  });

  it('caps recentlyViewed at 20 entries, newest first', async () => {
    for (let i = 0; i < 25; i++) {
      seed(`/docs/gen-${i}.md`);
      await useStore.getState().openFile(`/docs/gen-${i}.md`);
      await useStore.getState().close(`/docs/gen-${i}.md`);
    }
    const recent = useStore.getState().recentlyViewed;
    expect(recent).toHaveLength(20);
    expect(recent[0].path).toBe('/docs/gen-24.md');
  });

  it('closeOthers closes every doc except the given one', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');
    await useStore.getState().openFile('/docs/c.md');

    await useStore.getState().closeOthers('/docs/b.md');

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

    await useStore.getState().activate('/docs/a.md');

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

    await useStore.getState().activate('/docs/a.md');
    await Promise.resolve();

    expect(invoke).not.toHaveBeenCalledWith('render_markdown', expect.anything());
  });

  it('updates openedAt only when switching to a document', async () => {
    vi.useFakeTimers();
    const original = '2020-01-01T00:00:00.000Z';
    await useStore.getState().openFile('/docs/a.md', { openedAt: original, activate: false });
    await useStore.getState().openFile('/docs/b.md', { openedAt: original, activate: false });
    useStore.setState({ activeDocId: '/docs/b.md' });

    const navigatedAt = '2026-09-04T07:00:00.000Z';
    vi.setSystemTime(new Date(navigatedAt));
    await useStore.getState().activate('/docs/b.md');
    expect(useStore.getState().openDocs.find(d => d.path === '/docs/b.md')?.openedAt).toBe(original);

    await useStore.getState().activate('/docs/a.md');
    expect(useStore.getState().openDocs.find(d => d.path === '/docs/a.md')?.openedAt).toBe(navigatedAt);
    expect(useStore.getState().openDocs.find(d => d.path === '/docs/b.md')?.openedAt).toBe(original);
  });

  it('preserves persisted openedAt when restoring the active document', async () => {
    vi.useFakeTimers();
    const original = '2020-01-01T00:00:00.000Z';
    loadState.mockResolvedValue({
      version: 2,
      openDocs: ['/docs/a.md'],
      openedAt: { '/docs/a.md': original },
      activeDoc: '/docs/a.md',
      rightPaneDoc: null,
      recentlyViewed: [],
      scrollPositions: {},
      ui: { sidebarVisible: true, tocVisible: true, themeOverride: null },
    });
    vi.setSystemTime(new Date('2026-09-04T07:00:00.000Z'));

    await useStore.getState().hydrateFromDisk();

    expect(useStore.getState().openDocs[0].openedAt).toBe(original);
  });
});
describe('task checkbox updates', () => {
  it('sends exact coordinates and merges an updated document', async () => {
    await useStore.getState().openFile('/docs/a.md');
    const revision = useStore.getState().openDocs[0].revision;
    const updatedRevision = { sha256: 'updated', len: 8, file_id: 'seed:1' };
    taskResponse = {
      status: 'updated',
      document: { html: '<p>checked</p>', title: 'a', path: '/docs/a.md', headings: [], mtime: 2, revision: updatedRevision, local_images: [] },
    };

    await expect(useStore.getState().setTaskChecked('/docs/a.md', 3, 4, revision, true)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('set_task_checked', {
      path: '/docs/a.md', taskLine: 3, taskColumn: 4, expectedRevision: revision, checked: true,
    });
    expect(useStore.getState().openDocs[0]).toMatchObject({ html: '<p>checked</p>', revision: updatedRevision, dirty: false, removed: false });
  });

  it('reloads conflicts and does not commit an older completion over a newer render', async () => {
    await useStore.getState().openFile('/docs/a.md');
    const requestRevision = useStore.getState().openDocs[0].revision;
    const newerRevision = { sha256: 'newer', len: 9, file_id: 'seed:1' };
    useStore.setState(s => ({ openDocs: s.openDocs.map(d => ({ ...d, html: '<p>newer</p>', revision: newerRevision })) }));
    taskResponse = {
      status: 'conflict',
      reason: 'revision_changed',
      document: { html: '<p>stale conflict</p>', title: 'a', path: '/docs/a.md', headings: [], mtime: 1, revision: requestRevision, local_images: [] },
    };

    await expect(useStore.getState().setTaskChecked('/docs/a.md', 1, 4, requestRevision, true)).resolves.toBe(false);
    expect(useStore.getState().openDocs[0].html).toBe('<p>newer</p>');
    expect(useStore.getState().lastError).toBe('The file changed during the checkbox update. Reloaded the latest content without retrying.');
  });

  it('reconciles one failed write without retrying it', async () => {
    await useStore.getState().openFile('/docs/a.md');
    const revision = useStore.getState().openDocs[0].revision;
    const reconciledRevision = { sha256: 'reconciled', len: 12, file_id: 'seed:1' };
    seed('/docs/a.md', '<p>reconciled</p>', reconciledRevision);
    taskFailure = new Error('write failed');

    await expect(useStore.getState().setTaskChecked('/docs/a.md', 1, 4, revision, true)).resolves.toBe(false);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'set_task_checked')).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('render_markdown', { path: '/docs/a.md' });
    expect(useStore.getState().openDocs[0].html).toBe('<p>reconciled</p>');
    expect(useStore.getState().lastError).toBe('Checkbox update could not be confirmed: write failed');
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

describe('Markdown edit session', () => {
  function updatedResponse(path: string) {
    const document = rendered.get(path)!;
    return { status: 'updated', document: { ...document, path, mtime: 1 } };
  }

  it('keeps a second draft and queues it after an in-flight save', async () => {
    await useStore.getState().openFile('/docs/a.md');
    expect(await useStore.getState().beginEditing()).toBe(true);
    const gate = Promise.withResolvers<unknown>();
    saveResponses = [gate.promise, updatedResponse('/docs/a.md')];
    useStore.getState().updateEditDraft(Text.of(['first']));
    const first = useStore.getState().saveEdit();
    useStore.getState().updateEditDraft(Text.of(['second']));
    gate.resolve(updatedResponse('/docs/a.md'));
    await first;
    await vi.waitFor(() => expect(invoke.mock.calls.filter(call => call[0] === 'save_markdown_source')).toHaveLength(2));
    expect(useStore.getState().editSession?.status).toBe('clean');
  });

  it('retains a local draft and pauses autosave on conflict until reload', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().beginEditing();
    useStore.getState().updateEditDraft(Text.of(['local draft']));
    const latest = { source: 'disk\n', line_separator: '\n', document: { ...rendered.get('/docs/a.md')!, path: '/docs/a.md', mtime: 2 } };
    saveResponses = [{ status: 'conflict', latest, reason: 'revision_changed' }];
    expect(await useStore.getState().saveEdit()).toBe(false);
    expect(useStore.getState().editSession?.draft.toString()).toBe('local draft');
    expect(useStore.getState().editSession?.status).toBe('conflict');
    useStore.getState().reloadEditFromDisk();
    expect(useStore.getState().editSession?.draft.toString()).toBe('disk\n');
    expect(useStore.getState().editSession?.status).toBe('clean');
  });

  it('blocks switching when a dirty edit cannot be flushed', async () => {
    await useStore.getState().openFile('/docs/a.md');
    await useStore.getState().openFile('/docs/b.md');
    await useStore.getState().activate('/docs/a.md');
    await useStore.getState().beginEditing();
    useStore.getState().updateEditDraft(Text.of(['unsaved']));
    saveResponses = [Promise.reject(new Error('disk full'))];
    expect(await useStore.getState().activate('/docs/b.md')).toBe(false);
    expect(useStore.getState().activeDocId).toBe('/docs/a.md');
    expect(useStore.getState().editSession?.status).toBe('error');
  });
});
