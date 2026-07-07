import { test, expect } from '../empty-fixtures';

test('shows the empty-state hero and Open file CTA when no docs are open', async ({ tauriPage }) => {
  await expect(tauriPage.getByText('Drop a Markdown file anywhere in this window')).toBeVisible();
  await expect(tauriPage.getByText('Open file')).toBeVisible();
});

test('does not render a sidebar with no docs open', async ({ tauriPage }) => {
  await expect(tauriPage.locator('.peekmd-sidebar')).toHaveCount(0);
});
