import { createTauriTest } from '@srsholmes/tauri-playwright';

export const { test, expect } = createTauriTest({
  devUrl: 'http://localhost:1420',
  ipcMocks: {
    take_pending_paths: () => ['/tmp/peekmd-edit-fixture.md'],
    render_markdown: (args) => {
      const path = (args as { path?: string } | undefined)?.path ?? '/tmp/peekmd-edit-fixture.md';
      const source = (globalThis as { __editSource?: string }).__editSource ?? '# Distant heading\n\nIntro block.\n\n**bold text** and [inline link](other.md).\n\n[Reference][]\n\n[reference]: https://example.test/reference\n\nMore content.\n\nFinal block.\n';
      return {
        html: `<h1 data-sourcepos="1:1-1:18" id="peekmd-distant-heading"><a href="#peekmd-distant-heading" aria-hidden="true" class="anchor"></a><span data-sourcepos="1:3-1:18">${source.split('\n')[0].replace(/^# /, '')}</span></h1><p data-sourcepos="3:1-3:12"><span data-sourcepos="3:1-3:12">Intro block.</span></p><p data-sourcepos="5:1-5:56"><strong data-sourcepos="5:1-5:12"><span data-sourcepos="5:3-5:10">bold text</span></strong><span data-sourcepos="5:13-5:17"> and </span><a href="other.md" data-sourcepos="5:18-5:37"><span data-sourcepos="5:19-5:29">inline link</span></a><span data-sourcepos="5:38-5:38">.</span></p><p data-sourcepos="7:1-7:13"><a href="https://example.test/reference" data-sourcepos="7:1-7:13"><span data-sourcepos="7:1-7:9">Reference</span></a></p><p data-sourcepos="9:1-9:13"><span data-sourcepos="9:1-9:13">More content.</span></p><p data-sourcepos="11:1-11:12"><span data-sourcepos="11:1-11:12">Final block.</span></p>`,
        title: 'Edit fixture', path, headings: [{ id: 'peekmd-distant-heading', level: 1, text: source.split('\n')[0].replace(/^# /, '') }], mtime: 0,
        revision: { sha256: 'fixture', len: 1, file_id: '1:2' }, local_images: [],
      };
    },
    read_markdown_source: (args) => {
      const path = (args as { path?: string } | undefined)?.path ?? '/tmp/peekmd-edit-fixture.md';
      const source = (globalThis as { __editSource?: string }).__editSource ?? '# Distant heading\n\nIntro block.\n\n**bold text** and [inline link](other.md).\n\n[Reference][]\n\n[reference]: https://example.test/reference\n\nMore content.\n\nFinal block.\n';
      return { source, line_separator: '\n', document: { html: `<h1 data-sourcepos="1:1-1:18"><span data-sourcepos="1:3-1:18">Distant heading</span></h1><p data-sourcepos="3:1-3:12"><span data-sourcepos="3:1-3:12">Intro block.</span></p><p data-sourcepos="5:1-5:56"><strong data-sourcepos="5:1-5:12"><span data-sourcepos="5:3-5:10">bold text</span></strong> and <a href="other.md" data-sourcepos="5:18-5:37"><span data-sourcepos="5:19-5:29">inline link</span></a>.</p><p data-sourcepos="7:1-7:13"><a href="https://example.test/reference"><span data-sourcepos="7:1-7:9">Reference</span></a></p><p data-sourcepos="9:1-9:13"><span data-sourcepos="9:1-9:13">More content.</span></p><p data-sourcepos="11:1-11:12"><span data-sourcepos="11:1-11:12">Final block.</span></p>`, title: 'Edit fixture', path, headings: [{ id: 'peekmd-distant-heading', level: 1, text: 'Distant heading' }], mtime: 0, revision: { sha256: 'fixture', len: 1, file_id: '1:2' }, local_images: [] } };
    },
    save_markdown_source: (args) => {
      const source = (args as { source?: string } | undefined)?.source ?? '';
      if (source.includes('CONFLICT')) return { status: 'conflict', latest: { source: '# Disk version\n', line_separator: '\n', document: { html: '<h1 data-sourcepos="1:1-1:14">Disk version</h1>', title: 'Edit fixture', path: '/tmp/peekmd-edit-fixture.md', headings: [], mtime: 0, revision: { sha256: 'disk', len: 1, file_id: '1:3' }, local_images: [] } }, reason: 'revision_changed' };
      (globalThis as { __editSource?: string }).__editSource = source;
      return { status: 'updated', document: { html: `<h1 data-sourcepos="1:1-1:18">${source.split('\n')[0].replace(/^# /, '')}</h1>`, title: 'Edit fixture', path: '/tmp/peekmd-edit-fixture.md', headings: [], mtime: 1, revision: { sha256: 'saved', len: source.length, file_id: '1:2' }, local_images: [] } };
    },
    watch_paths: () => null, watch_images: () => null, unwatch: () => null, unwatch_images: () => null,
    resolve_md_link: () => null, open_url: () => null,
    'plugin:store|load': () => 0, 'plugin:store|get': () => [null, false], 'plugin:store|set': () => null, 'plugin:store|save': () => null,
  },
});
