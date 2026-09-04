import { test, expect } from '../fixtures';

// The fixture seeds one doc via `take_pending_paths`, so every test here
// boots straight into the "one doc open" state — see `e2e/fixtures.ts`.

test('renders the seeded document title in the topbar and body', async ({ tauriPage }) => {
  await expect(tauriPage.locator('.peekmd-topbar-title')).toContainText('Hello PeekMD');
  await expect(tauriPage.locator('h1#peekmd-hello')).toContainText('Hello PeekMD');
});

test('shows the full link target in the status bar on hover', async ({ tauriPage }) => {
  const link = tauriPage.locator('.markdown-body a[href="https://example.com/reference"]');
  await link.hover();

  await expect(tauriPage.locator('.peekmd-statusbar')).toHaveClass(/is-active/);
  await expect(tauriPage.locator('.peekmd-statusbar-link')).toHaveText('https://example.com/reference');

  await tauriPage.locator('.peekmd-sidebar-row').first().hover();
  await expect(tauriPage.locator('.peekmd-statusbar')).not.toHaveClass(/is-active/);
});

test('keeps the status bar pinned to the middle content viewport while scrolling', async ({ tauriPage }) => {
  await tauriPage.evaluate(`(() => {
    const scroll = document.querySelector('.peekmd-doc-scroll');
    const spacer = document.createElement('div');
    spacer.style.height = '2000px';
    scroll?.append(spacer);
  })()`);

  const positions = async () => tauriPage.evaluate(`(() => {
    const area = document.querySelector('.peekmd-doc-area')?.getBoundingClientRect();
    const status = document.querySelector('.peekmd-statusbar')?.getBoundingClientRect();
    return { areaBottom: area?.bottom, statusBottom: status?.bottom };
  })()`);
  const before = await positions();

  await tauriPage.evaluate(`(() => {
    const scroll = document.querySelector('.peekmd-doc-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  })()`);
  const after = await positions();

  expect(Math.abs((before.statusBottom ?? 0) - (before.areaBottom ?? 0))).toBeLessThan(1);
  expect(Math.abs((after.statusBottom ?? 0) - (after.areaBottom ?? 0))).toBeLessThan(1);
});

test('shows a sidebar entry for the open document', async ({ tauriPage }) => {
  await expect(tauriPage.locator('.peekmd-sidebar')).toBeVisible();
});

test('⌘\\ hides and re-shows the sidebar', async ({ tauriPage }) => {
  await expect(tauriPage.locator('.peekmd-sidebar')).toBeVisible();

  await tauriPage.keyboard.press('Meta+\\');
  await expect(tauriPage.locator('.peekmd-sidebar')).toHaveCount(0);

  await tauriPage.keyboard.press('Meta+\\');
  await expect(tauriPage.locator('.peekmd-sidebar')).toBeVisible();
});

test('theme toggle button flips data-theme on <html>', async ({ tauriPage }) => {
  const before = await tauriPage.evaluate<string>('document.documentElement.dataset.theme');

  await tauriPage.click('[title="Toggle theme (⌘⇧D)"]');

  const after = await tauriPage.evaluate<string>('document.documentElement.dataset.theme');
  expect(after).not.toBe(before);
  expect(['light', 'dark']).toContain(after);
});

test('⌘K opens the command palette, Escape closes it', async ({ tauriPage }) => {
  await expect(tauriPage.locator('[role="dialog"][aria-label="Command palette"]')).toHaveCount(0);

  await tauriPage.keyboard.press('Meta+k');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Command palette"]')).toBeVisible();
  await expect(tauriPage.getByText('Hello PeekMD').first()).toBeVisible();

  await tauriPage.keyboard.press('Escape');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Command palette"]')).toHaveCount(0);
});

test('⌘W while the command palette is open does not close the document (modal-capture guard)', async ({ tauriPage }) => {
  // Regression test: global keybindings used to fire underneath the palette,
  // so ⌘W closed the active document while the user was still typing a
  // command — see lib/keybindings.ts's paletteOpen/findOpen guard.
  await tauriPage.keyboard.press('Meta+k');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Command palette"]')).toBeVisible();

  await tauriPage.keyboard.press('Meta+w');

  await expect(tauriPage.locator('.peekmd-topbar-title')).toContainText('Hello PeekMD');
});
