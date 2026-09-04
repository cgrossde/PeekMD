import { test, expect } from '../task-checkbox-fixtures';
import { test as deferredTest } from '../task-checkbox-deferred-fixtures';

test('toggles generated tasks with mouse and Space using one IPC call each', async ({ tauriPage }) => {
  await expect(tauriPage.locator('input.task-list-item-checkbox')).toHaveCount(3);
  const parent = tauriPage.locator('input[data-task-line="1"]');
  await parent.click();
  await expect(parent).toBeChecked();
  expect(await tauriPage.evaluate<number>('globalThis.__taskCalls')).toBe(1);

  const nested = tauriPage.locator('input[data-task-line="2"]');
  await nested.focus();
  await tauriPage.keyboard.press('Space');
  await expect.poll(() => tauriPage.evaluate<number>('globalThis.__taskCalls')).toBe(2);
  await expect(nested).not.toBeChecked();
  expect(await tauriPage.evaluate<number>('globalThis.__taskCalls')).toBe(2);
});

test('excludes raw checkboxes and preserves link behavior', async ({ tauriPage }) => {
  await expect(tauriPage.locator('input.task-list-item-checkbox')).toHaveCount(3);
  const raw = tauriPage.locator('input[type="checkbox"]:not(.task-list-item-checkbox)');
  await expect(raw).toHaveCount(1);
  await raw.click();
  expect(await tauriPage.evaluate<number>('globalThis.__taskCalls ?? 0')).toBe(0);

  await tauriPage.locator('a[href="#parent-link"]').click();
  await expect(tauriPage).toHaveURL(/#parent-link$/);
  expect(await tauriPage.evaluate<number>('globalThis.__taskCalls ?? 0')).toBe(0);
});


deferredTest('disables generated controls during a checkbox update', async ({ tauriPage }) => {
  await expect(tauriPage.locator('input[data-task-line="1"]')).toHaveCount(1);
  const disabledDuringDispatch = await tauriPage.evaluate("(() => { const input = document.querySelector('input[data-task-line=\\\"1\\\"]'); if (!input) return false; input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); return Array.from(document.querySelectorAll('.task-list-item-checkbox')).every(control => control.disabled); })()");
  expect(disabledDuringDispatch).toBe(true);
  await expect(tauriPage.locator('input.task-list-item-checkbox:disabled')).toHaveCount(0);
  await expect(tauriPage.locator('input[data-task-line="1"]')).toBeChecked();
});
