import { createTauriTest } from '@srsholmes/tauri-playwright';

export const { test, expect } = createTauriTest({
  devUrl: 'http://localhost:1420',
  ipcMocks: {
    take_pending_paths: () => ['/tmp/peekmd-task-checkbox-failure.md'],
    render_markdown: (args) => ({
      html: '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" data-task-line="1" data-task-column="4" aria-label="Mark task on line 1 complete" /> Parent</li></ul>',
      title: 'Task checkbox failure fixture', path: (args as { path?: string } | undefined)?.path ?? '/tmp/peekmd-task-checkbox-failure.md',
      headings: [], mtime: 0, revision: { sha256: 'unchecked', len: 10, file_id: '1:2' }, local_images: [],
    }),
    watch_paths: () => null, watch_images: () => null, unwatch: () => null, unwatch_images: () => null,
    set_task_checked: (args) => ({
      status: 'conflict', reason: 'revision_changed',
      document: {
        html: '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" data-task-line="1" data-task-column="4" aria-label="Mark task on line 1 complete" /> Parent</li></ul>',
        title: 'Task checkbox failure fixture', path: (args as { path: string }).path, headings: [], mtime: 0,
        revision: { sha256: 'unchecked', len: 10, file_id: '1:2' }, local_images: [],
      },
    }),
    'plugin:store|load': () => 0, 'plugin:store|get': () => [null, false],
    'plugin:store|set': () => null, 'plugin:store|save': () => null,
  },
});
