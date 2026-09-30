import { test, expect } from '../edit-mode-fixtures';

test('transfers a clicked preview cursor into the focused editor', async ({ tauriPage }) => {
  const leaf = tauriPage.locator('.markdown-body span[data-sourcepos="3:1-3:12"]');
  await leaf.click({ position: { x: 12, y: 8 } });
  await expect(tauriPage.locator('.peekmd-preview-caret')).toBeVisible();
  await tauriPage.keyboard.press('Meta+Enter');
  const editor = tauriPage.locator('.cm-content');
  await expect(editor).toBeVisible();
  expect(await editor.evaluate((element: Element) => element === document.activeElement)).toBe(true);
});

test('preserves the exact source cursor through repeated preview round trips', async ({ tauriPage }) => {
  await tauriPage.keyboard.press('Meta+Enter');
  const editor = tauriPage.locator('.cm-content');
  const referenceLine = tauriPage.locator('.cm-line').nth(6);
  await referenceLine.click();
  await editor.press('End');

  await tauriPage.keyboard.press('Meta+Enter');
  const previewCaret = tauriPage.locator('.peekmd-preview-caret');
  await expect(tauriPage.locator('.markdown-body')).toBeVisible();
  await expect(previewCaret).toBeVisible();
  expect(await previewCaret.evaluate((element: Element) => element.getBoundingClientRect().height)).toBeGreaterThan(0);

  await tauriPage.keyboard.press('Meta+Enter');
  await tauriPage.keyboard.type(' CURSOR');
  await expect(referenceLine).toContainText('[Reference][] CURSOR');

  await tauriPage.keyboard.press('Meta+Enter');
  await expect(previewCaret).toBeVisible();
  expect(await previewCaret.evaluate((element: Element) => {
    const selection = element.ownerDocument.getSelection();
    const anchor = selection?.anchorNode;
    const parent = anchor instanceof Element ? anchor : anchor?.parentElement;
    return parent?.closest('[data-sourcepos]')?.getAttribute('data-sourcepos') ?? null;
  })).toBe('7:14-7:20');
  await tauriPage.keyboard.press('Meta+Enter');
  await tauriPage.keyboard.type(' AGAIN');
  await expect(referenceLine).toContainText('[Reference][] CURSOR AGAIN');
});

test('enters source mode with visible Markdown markers and styled headings', async ({ tauriPage }) => {
  await tauriPage.keyboard.press('Meta+Enter');
  await expect(tauriPage.locator('.cm-editor')).toBeVisible();
  await expect(tauriPage.locator('.cm-gutters')).toBeVisible();
  await expect(tauriPage.locator('.cm-content')).toContainText('**bold text**');
  expect(await tauriPage.locator('.cm-line.peekmd-editor-heading-1').evaluate((element: Element) => getComputedStyle(element).fontWeight)).toBe('700');
  expect(await tauriPage.locator('.cm-line.peekmd-editor-heading-1').evaluate((element: Element) => getComputedStyle(element).fontSize)).toMatch(/px/);
});

test('debounced edit saves and returns to rendered preview', async ({ tauriPage }) => {
  await tauriPage.keyboard.press('Meta+Enter');
  const editor = tauriPage.locator('.cm-content');
  await editor.click();
  await editor.press('ControlOrMeta+Home');
  await editor.press('Delete');
  await tauriPage.keyboard.type('Updated');
  await expect(tauriPage.locator('.peekmd-statusbar')).toContainText('Saved', { timeout: 3000 });
  await tauriPage.keyboard.press('Meta+Enter');
  await expect(tauriPage.locator('.markdown-body')).toBeVisible();
  await expect(tauriPage.locator('.markdown-body h1')).toContainText('Updated Distant heading');
});

test('preserves the source cursor and synchronized scroll region across preview', async ({ tauriPage }) => {
  await tauriPage.locator('head').evaluate((head: Element) => { const style = document.createElement('style'); style.textContent = '.peekmd-doc-scroll { height: 260px !important; } .markdown-body [data-sourcepos], .cm-line { min-height: 120px; }'; head.append(style); });
  await tauriPage.keyboard.press('Meta+Enter');
  const editor = tauriPage.locator('.cm-content');
  const cursorLine = tauriPage.locator('.cm-line').nth(6);
  await cursorLine.click();
  await editor.press('End');
  await tauriPage.locator('.cm-line').nth(8).scrollIntoViewIfNeeded();
  const editorTop = await tauriPage.locator('.peekmd-doc-scroll').evaluate((element: Element) => element.scrollTop);
  expect(editorTop).toBeGreaterThan(0);

  await tauriPage.keyboard.press('Meta+Enter');
  await expect(tauriPage.locator('.markdown-body')).toBeVisible();
  const previewTop = await tauriPage.locator('.peekmd-doc-scroll').evaluate((element: Element) => element.scrollTop);
  expect(previewTop).toBeGreaterThan(0);

  await tauriPage.keyboard.press('Meta+Enter');
  await tauriPage.keyboard.type(' CURSOR');
  await expect(cursorLine).toContainText('[Reference][] CURSOR');
  const restoredEditorTop = await tauriPage.locator('.peekmd-doc-scroll').evaluate((element: Element) => element.scrollTop);
  expect(restoredEditorTop).toBeGreaterThan(0);
});

test('conflict keeps the draft visible and offers recovery actions', async ({ tauriPage }) => {
  await tauriPage.keyboard.press('Meta+Enter');
  const editor = tauriPage.locator('.cm-content');
  await editor.click();
  await editor.press('ControlOrMeta+End');
  await tauriPage.keyboard.type(' CONFLICT');
  await expect(tauriPage.locator('.peekmd-editor-banner')).toContainText('Autosave paused', { timeout: 3000 });
  await expect(tauriPage.getByRole('button', { name: 'Reload from Disk (Discard Draft)' })).toBeVisible();
  await expect(tauriPage.getByRole('button', { name: 'Overwrite Disk' })).toBeVisible();
});
