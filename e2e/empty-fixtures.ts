import { createTauriTest } from '@srsholmes/tauri-playwright';

// Variant of `fixtures.ts` for specs that need the true zero-docs boot state.
// `ipcMocks` are fixed per `createTauriTest()` call, so the "seeded doc" and
// "empty" worlds live in separate fixture modules rather than one shared one.
export const { test, expect } = createTauriTest({
  devUrl: 'http://localhost:1420',
  ipcMocks: {
    take_pending_paths: () => [],
    render_markdown: () => {
      throw new Error('render_markdown should not be called with no docs open');
    },
    watch_paths: () => null,
    unwatch: () => null,
    'plugin:store|load': () => 0,
    'plugin:store|get': () => [null, false],
    'plugin:store|set': () => null,
    'plugin:store|save': () => null,
  },
});
