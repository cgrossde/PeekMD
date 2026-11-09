import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { installTaskCheckboxHandler } from './taskCheckboxes';

const revision = { sha256: 'abc', len: 10, file_id: '1:2' };
const path = '/docs/task.md';
const baseline = useStore.getState();

type TaskSetter = (path: string, line: number, column: number, expectedRevision: typeof revision, checked: boolean) => Promise<boolean>;
function mount(html: string) {
  const container = document.createElement('div');
  container.innerHTML = `<div class="markdown-body">${html}</div>`;
  document.body.append(container);
  return container;
}

function setActive(setTaskChecked: TaskSetter) {
  useStore.setState({
    openDocs: [{ path, title: 'task', html: '', meta: null, headings: [], mtime: 0, revision, dirty: false }],
    activeDocId: path,
    setTaskChecked,
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  useStore.setState(baseline, true);
  vi.restoreAllMocks();
});

describe('installTaskCheckboxHandler', () => {
  it('delegates through innerHTML replacement and sends exact request data', async () => {
    const setTaskChecked = vi.fn().mockResolvedValue(true);
    setActive(setTaskChecked);
    const container = mount('');
    const cleanup = installTaskCheckboxHandler(() => container);
    const body = container.querySelector('.markdown-body')!;
    body.innerHTML = '<input class="task-list-item-checkbox" data-task-line="7" data-task-column="4" type="checkbox">';
    const input = body.querySelector('input') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(setTaskChecked).toHaveBeenCalledOnce());
    expect(setTaskChecked).toHaveBeenCalledWith(path, 7, 4, revision, true);
    cleanup();
  });

  it('ignores raw and malformed checkbox controls', async () => {
    const setTaskChecked = vi.fn().mockResolvedValue(true);
    setActive(setTaskChecked);
    const container = mount(`
      <input type="checkbox" data-task-line="1" data-task-column="4">
      <input class="task-list-item-checkbox" data-task-line="0" data-task-column="4" type="checkbox">
      <input class="task-list-item-checkbox" data-task-line="1.5" data-task-column="4" type="checkbox">
    `);
    const cleanup = installTaskCheckboxHandler(() => container);
    container.querySelectorAll('input').forEach(input => input.dispatchEvent(new Event('change', { bubbles: true })));
    await Promise.resolve();
    expect(setTaskChecked).not.toHaveBeenCalled();
    cleanup();
  });

  it('allows one in-flight operation and re-enables current rendered controls', async () => {
    let resolve!: (value: boolean) => void;
    const setTaskChecked = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
    setActive(setTaskChecked);
    const container = mount(`
      <input class="task-list-item-checkbox" data-task-line="1" data-task-column="4" type="checkbox">
      <input class="task-list-item-checkbox" data-task-line="2" data-task-column="4" type="checkbox">
    `);
    const cleanup = installTaskCheckboxHandler(() => container);
    const inputs = container.querySelectorAll('input');
    const first = inputs[0] as HTMLInputElement;
    first.checked = true;
    first.dispatchEvent(new Event('change', { bubbles: true }));
    expect(Array.from(inputs).every(input => input.disabled)).toBe(true);
    (inputs[1] as HTMLInputElement).checked = true;
    inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
    expect(setTaskChecked).toHaveBeenCalledOnce();

    container.querySelector('.markdown-body')!.innerHTML = '<input class="task-list-item-checkbox" data-task-line="3" data-task-column="4" type="checkbox" disabled>';
    resolve(true);
    await vi.waitFor(() => expect((container.querySelector('input') as HTMLInputElement).disabled).toBe(false));
    cleanup();
  });

  it('rolls back a failed connected input but not a detached stale node', async () => {
    const setTaskChecked = vi.fn().mockResolvedValue(false);
    setActive(setTaskChecked);
    const container = mount('<input class="task-list-item-checkbox" data-task-line="1" data-task-column="4" type="checkbox">');
    const cleanup = installTaskCheckboxHandler(() => container);
    const input = container.querySelector('input') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(input.checked).toBe(false));

    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.remove();
    await Promise.resolve();
    expect(input.checked).toBe(true);
    cleanup();
  });
});
