import { useStore } from '../store';

const TASK_CHECKBOX_SELECTOR = 'input.task-list-item-checkbox[data-task-line][data-task-column]';

export function installTaskCheckboxHandler(getContainer: () => HTMLElement | null): () => void {
  let inFlight = false;

  const handler = async (event: Event) => {
    if (inFlight || !(event.target instanceof HTMLInputElement)) return;
    const container = getContainer();
    const body = container?.querySelector<HTMLElement>('.markdown-body');
    const input = event.target;
    if (!body || !body.contains(input) || !input.matches(TASK_CHECKBOX_SELECTOR)) return;

    const line = Number(input.dataset.taskLine);
    const column = Number(input.dataset.taskColumn);
    if (!Number.isSafeInteger(line) || line <= 0 || !Number.isSafeInteger(column) || column <= 0) return;

    const state = useStore.getState();
    const active = state.openDocs.find(doc => doc.path === state.activeDocId);
    if (!active) return;
    const checked = input.checked;
    const previousChecked = !checked;
    const controls = () => container?.querySelectorAll<HTMLInputElement>(TASK_CHECKBOX_SELECTOR) ?? [];
    inFlight = true;
    controls().forEach(control => { control.disabled = true; });
    try {
      const succeeded = await state.setTaskChecked(active.path, line, column, active.revision, checked);
      if (!succeeded && input.isConnected) input.checked = previousChecked;
    } catch {
      if (input.isConnected) input.checked = previousChecked;
    } finally {
      inFlight = false;
      controls().forEach(control => { control.disabled = false; });
    }
  };

  const container = getContainer();
  container?.addEventListener('change', handler);
  return () => container?.removeEventListener('change', handler);
}
