import { createTauriTest } from '@srsholmes/tauri-playwright';

export const { test } = createTauriTest({
  devUrl: 'http://localhost:1420',
  ipcMocks: {
    take_pending_paths: () => ['/tmp/peekmd-task-checkbox-deferred.md'],
    render_markdown: (args) => ({
      html: '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" data-task-line="1" data-task-column="4" aria-label="Mark task on line 1 complete" /><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" data-task-line="2" data-task-column="6" checked="" aria-label="Mark task on line 2 incomplete" /></li></ul></li></ul>',
      title: 'Task checkbox deferred fixture', path: (args as { path?: string } | undefined)?.path ?? '/tmp/peekmd-task-checkbox-deferred.md',
      headings: [], mtime: 0, revision: { sha256: 'unchecked', len: 10, file_id: '1:2' }, local_images: [],
    }),
    set_task_checked: (args) => ({
      status: 'updated',
      document: {
        html: '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" data-task-line="1" data-task-column="4" checked="" aria-label="Mark task on line 1 complete" /></li></ul>',
        title: 'Task checkbox deferred fixture', path: (args as { path: string }).path, headings: [], mtime: 0,
        revision: { sha256: 'checked', len: 10, file_id: '1:2' }, local_images: [],
      },
    }),
    watch_paths: () => null, watch_images: () => null, unwatch: () => null, unwatch_images: () => null,
    resolve_md_link: () => null, show_sidebar_context_menu: () => null,
    'plugin:store|load': () => 0, 'plugin:store|get': () => [null, false],
    'plugin:store|set': () => null, 'plugin:store|save': () => null,
  },
});
