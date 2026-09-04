import { test, expect } from '../task-checkbox-failure-fixtures';

test('rolls back a conflict to authoritative unchecked content', async ({ tauriPage }) => {
  const checkbox = tauriPage.locator('input[data-task-line="1"]');
  await expect(checkbox).toHaveCount(1);
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
});
