import { createTauriTest } from '@srsholmes/tauri-playwright';

export const { test, expect } = createTauriTest({
  devUrl: 'http://localhost:1420',
  ipcMocks: {
    take_pending_paths: () => ['/tmp/peekmd-task-checkbox-fixture.md'],
    render_markdown: (args) => {
      const path = (args as { path?: string } | undefined)?.path ?? '/tmp/peekmd-task-checkbox-fixture.md';
      const state = globalThis as typeof globalThis & { __taskChecked?: boolean };
      const checked = Boolean(state.__taskChecked);
      return {
        html:
          '<ul class="contains-task-list" data-sourcepos="1:1-2:14">' +
          '<li class="task-list-item" data-sourcepos="1:1-2:14"><input type="checkbox" class="task-list-item-checkbox" data-task-line="1" data-task-column="4"' +
          (checked ? ' checked=""' : '') +
          ' aria-label="Mark task on line 1 complete" /> Parent <a href="#parent-link">link</a>' +
          '<ul class="contains-task-list" data-sourcepos="2:3-2:14"><li class="task-list-item" data-sourcepos="2:3-2:14"><input type="checkbox" class="task-list-item-checkbox" data-task-line="2" data-task-column="6" checked="" aria-label="Mark task on line 2 incomplete" /> Nested</li></ul></li></ul>' +
          '<p><input type="checkbox" class="task-list-item-checkbox" data-task-line="3" data-task-column="4" aria-label="Mark task on line 3 complete" /> Failure task</p><p><input type="checkbox"> raw checkbox</p>\n',
        title: 'Task checkbox fixture',
        path,
        headings: [],
        mtime: 0,
        revision: { sha256: checked ? 'checked' : 'unchecked', len: 10, file_id: '1:2' },
        local_images: [],
      };
    },
    set_task_checked: (args) => {
      const input = args as { path: string; checked: boolean; taskLine: number; taskColumn: number };
      const state = globalThis as typeof globalThis & { __taskCalls?: number };
      state.__taskCalls = (state.__taskCalls ?? 0) + 1;
      const nestedChecked = input.taskLine === 2 ? '' : ' checked=""';
      const document = {
        html: '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" data-task-line="1" data-task-column="4"' +
          (input.checked ? ' checked=""' : '') +
          ' aria-label="Mark task on line 1 complete" /> Parent <a href="#parent-link">link</a><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" data-task-line="2" data-task-column="6"' +
          nestedChecked + ' aria-label="Mark task on line 2 incomplete" /> Nested</li></ul></li></ul><p><input type="checkbox" class="task-list-item-checkbox" data-task-line="3" data-task-column="4" aria-label="Mark task on line 3 complete" /> Failure task</p><p><input type="checkbox"> raw checkbox</p>',
        title: 'Task checkbox fixture', path: input.path, headings: [], mtime: 0,
        revision: { sha256: input.checked ? 'checked' : 'unchecked', len: 10, file_id: '1:2' }, local_images: [],
      };
      if (input.taskLine === 3) return { status: 'conflict', reason: 'revision_changed', document };
      const finish = () => ({ status: 'updated', document });
      if (input.taskColumn === 98) return new Promise(resolve => { setTimeout(() => resolve(finish()), 500); });
      return finish();
    },
    watch_paths: () => null,
    watch_images: () => null,
    unwatch: () => null,
    unwatch_images: () => null,
    reveal_in_finder: () => null,
    copy_path: () => null,
    copy_html: () => null,
    resolve_md_link: () => null,
    show_sidebar_context_menu: () => null,
    'plugin:store|load': () => 0,
    'plugin:store|get': () => [null, false],
    'plugin:store|set': () => null,
    'plugin:store|save': () => null,
  },
});
