import { readFileSync } from 'node:fs';
import { createTauriTest } from '@srsholmes/tauri-playwright';

const fixturePath = '/tmp/peekmd-edit-fixture.md';
const initialSource = readFileSync(new URL('../.claude/skills/debug/fixtures/cursor.md', import.meta.url), 'utf8');

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function renderedHtml(source: string): string {
  const lines = source.split('\n');
  const heading = escapeHtml(lines[0]?.replace(/^# /, '') ?? '');
  const referenceLine = lines[6] ?? '[Reference][]';
  const referenceSuffix = referenceLine.startsWith('[Reference][]') ? referenceLine.slice(13) : '';
  const referenceEnd = Math.max(referenceLine.length, 1);
  const suffix = referenceSuffix
    ? `<span data-sourcepos="7:14-7:${referenceEnd}">${escapeHtml(referenceSuffix)}</span>`
    : '';
  return `<h1 data-sourcepos="1:1-1:${Math.max(lines[0]?.length ?? 1, 1)}" id="peekmd-distant-heading"><a href="#peekmd-distant-heading" aria-hidden="true" class="anchor"></a><span data-sourcepos="1:3-1:${Math.max(lines[0]?.length ?? 1, 3)}">${heading}</span></h1><p data-sourcepos="3:1-3:12"><span data-sourcepos="3:1-3:12">Intro block.</span></p><p data-sourcepos="5:1-5:42"><strong data-sourcepos="5:1-5:13"><span data-sourcepos="5:3-5:11">bold text</span></strong><span data-sourcepos="5:14-5:18"> and </span><a href="other.md" data-sourcepos="5:19-5:41"><span data-sourcepos="5:20-5:30">inline link</span></a><span data-sourcepos="5:42-5:42">.</span></p><p data-sourcepos="7:1-7:${referenceEnd}"><a href="https://example.test/reference" data-sourcepos="7:1-7:13"><span data-sourcepos="7:2-7:10">Reference</span></a>${suffix}</p><p data-sourcepos="9:1-9:53"><code data-sourcepos="9:1-9:13">inline code</code> and an image: <img data-sourcepos="9:29-9:53" src="missing-image.png" alt="alt"></p><p data-sourcepos="13:1-13:13"><span data-sourcepos="13:1-13:13">More content.</span></p><p data-sourcepos="15:1-15:12"><span data-sourcepos="15:1-15:12">Final block.</span></p>`;
}

function documentFor(source: string, path: string, sha256: string, mtime: number) {
  const heading = source.split('\n')[0]?.replace(/^# /, '') ?? '';
  return {
    html: renderedHtml(source),
    title: 'Edit fixture',
    path,
    headings: [{ id: 'peekmd-distant-heading', level: 1, text: heading }],
    mtime,
    revision: { sha256, len: source.length, file_id: '1:2' },
    local_images: [],
  };
}

const initialDocument = documentFor(initialSource, fixturePath, 'fixture', 0);

export const { test, expect } = createTauriTest({
  devUrl: 'http://localhost:1420',
  ipcContext: { fixturePath, initialSource, initialDocument },
  ipcMocks: {
    take_pending_paths: () => {
      Reflect.set(globalThis, '__editSource', initialSource);
      Reflect.set(globalThis, '__editDocument', initialDocument);
      return [fixturePath];
    },
    render_markdown: (args) => {
      const path = args && typeof args === 'object' && 'path' in args && typeof args.path === 'string' ? args.path : fixturePath;
      const document = Reflect.get(globalThis, '__editDocument') ?? initialDocument;
      return { ...document, path };
    },
    read_markdown_source: (args) => {
      const path = args && typeof args === 'object' && 'path' in args && typeof args.path === 'string' ? args.path : fixturePath;
      const source = Reflect.get(globalThis, '__editSource') ?? initialSource;
      const document = Reflect.get(globalThis, '__editDocument') ?? initialDocument;
      return { source, line_separator: '\n', document: { ...document, path } };
    },
    save_markdown_source: (args) => {
      const source = args && typeof args === 'object' && 'source' in args && typeof args.source === 'string' ? args.source : '';
      if (source.includes('CONFLICT')) {
        const latestSource = '# Disk version\n';
        return { status: 'conflict', latest: { source: latestSource, line_separator: '\n', document: { ...initialDocument, html: '<h1 data-sourcepos="1:1-1:14">Disk version</h1>', headings: [], revision: { sha256: 'disk', len: latestSource.length, file_id: '1:3' } } }, reason: 'revision_changed' };
      }
      const lines = source.split('\n');
      const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const heading = escape(lines[0]?.replace(/^# /, '') ?? '');
      const referenceLine = lines[6] ?? '[Reference][]';
      const referenceSuffix = referenceLine.startsWith('[Reference][]') ? referenceLine.slice(13) : '';
      const referenceEnd = Math.max(referenceLine.length, 1);
      const suffix = referenceSuffix ? `<span data-sourcepos="7:14-7:${referenceEnd}">${escape(referenceSuffix)}</span>` : '';
      const html = `<h1 data-sourcepos="1:1-1:${Math.max(lines[0]?.length ?? 1, 1)}" id="peekmd-distant-heading"><span data-sourcepos="1:3-1:${Math.max(lines[0]?.length ?? 1, 3)}">${heading}</span></h1><p data-sourcepos="3:1-3:12"><span data-sourcepos="3:1-3:12">Intro block.</span></p><p data-sourcepos="5:1-5:42"><strong data-sourcepos="5:1-5:13"><span data-sourcepos="5:3-5:11">bold text</span></strong><span data-sourcepos="5:14-5:18"> and </span><a href="other.md" data-sourcepos="5:19-5:41"><span data-sourcepos="5:20-5:30">inline link</span></a><span data-sourcepos="5:42-5:42">.</span></p><p data-sourcepos="7:1-7:${referenceEnd}"><a href="https://example.test/reference" data-sourcepos="7:1-7:13"><span data-sourcepos="7:2-7:10">Reference</span></a>${suffix}</p><p data-sourcepos="9:1-9:53"><code data-sourcepos="9:1-9:13">inline code</code> and an image: <img data-sourcepos="9:29-9:53" src="missing-image.png" alt="alt"></p><p data-sourcepos="13:1-13:13"><span data-sourcepos="13:1-13:13">More content.</span></p><p data-sourcepos="15:1-15:12"><span data-sourcepos="15:1-15:12">Final block.</span></p>`;
      const document = { ...initialDocument, html, headings: [{ id: 'peekmd-distant-heading', level: 1, text: lines[0]?.replace(/^# /, '') ?? '' }], mtime: 1, revision: { sha256: 'saved', len: source.length, file_id: '1:2' } };
      Reflect.set(globalThis, '__editSource', source);
      Reflect.set(globalThis, '__editDocument', document);
      return { status: 'updated', document };
    },
    watch_paths: () => null,
    watch_images: () => null,
    unwatch: () => null,
    unwatch_images: () => null,
    resolve_md_link: () => null,
    open_url: () => null,
    'plugin:store|load': () => 0,
    'plugin:store|get': () => [null, false],
    'plugin:store|set': () => null,
    'plugin:store|save': () => null,
  },
});
