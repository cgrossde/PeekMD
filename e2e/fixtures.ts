import { createTauriTest } from '@srsholmes/tauri-playwright';

// Boots straight into a single seeded document via `take_pending_paths` (the
// same command the real app polls on launch for CLI-arg / Open With / Finder
// double-click). Most flows below (topbar title, sidebar, command palette,
// find, theme) need a doc open — starting loaded keeps each spec focused on
// the behavior under test instead of driving the native file dialog, which
// can't be automated in browser mode. See `empty-fixtures.ts` for the
// no-doc-open state.
//
// NOTE: every mock function is serialized via `toString()` and re-evaluated
// in the browser context, so each one must be self-contained — no closures
// over module-scope constants.
export const { test, expect } = createTauriTest({
  devUrl: 'http://localhost:1420',
  ipcMocks: {
    take_pending_paths: () => ['/tmp/peekmd-e2e-fixture.md'],
    render_markdown: (args) => {
      const path = (args as { path?: string } | undefined)?.path ?? '/tmp/peekmd-e2e-fixture.md';
      return {
        html:
          '<h1 data-sourcepos="1:1-1:13" id="peekmd-hello"><a href="#peekmd-hello" aria-hidden="true" class="anchor"></a>Hello PeekMD</h1>\n' +
          '<p data-sourcepos="3:1-3:29">A <strong>fixture</strong> document for e2e tests.</p>\n',
        title: 'Hello PeekMD',
        path,
        headings: [{ id: 'peekmd-hello', level: 1, text: 'Hello PeekMD' }],
        mtime: 0,
      };
    },
    watch_paths: () => null,
    unwatch: () => null,
    reveal_in_finder: () => null,
    copy_path: () => null,
    copy_html: () => null,
    resolve_md_link: () => null,
    show_sidebar_context_menu: () => null,
    // tauri-plugin-store (session persistence): `load` returns a numeric
    // resource id, `get` returns a `[value, exists]` tuple. Reporting
    // "nothing persisted" keeps every run starting from the same defaults.
    'plugin:store|load': () => 0,
    'plugin:store|get': () => [null, false],
    'plugin:store|set': () => null,
    'plugin:store|save': () => null,
  },
});
