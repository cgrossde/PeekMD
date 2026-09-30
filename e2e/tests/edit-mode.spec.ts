import { test, expect } from '../edit-mode-fixtures';

test('transfers a clicked preview cursor into the focused editor', async ({ tauriPage }) => {
  const leaf = tauriPage.locator('.markdown-body span[data-sourcepos="3:1-3:12"]');
  await leaf.click({ position: { x: 12, y: 8 } });
  await expect(tauriPage.locator('.peekmd-preview-caret')).toBeVisible();
  const previewOffset = await leaf.evaluate((element: Element) => element.ownerDocument.getSelection()?.anchorOffset ?? -1);
  await tauriPage.keyboard.press('Meta+Enter');
  const editor = tauriPage.locator('.cm-content');
  await expect(editor).toBeVisible();
  expect(await editor.evaluate((element: Element) => element === document.activeElement)).toBe(true);
  expect(Number(await tauriPage.locator('.peekmd-editor').getAttribute('data-cursor-offset'))).toBe(19 + previewOffset);
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

test('restores a cursor inside plain text after inline code', async ({ tauriPage }) => {
  await tauriPage.keyboard.press('Meta+Enter');
  const editor = tauriPage.locator('.cm-content');
  const mixedLine = tauriPage.locator('.cm-line').nth(8);
  await mixedLine.click();
  await editor.press('Home');
  for (let index = 0; index < 17; index += 1) await editor.press('ArrowRight');

  await tauriPage.keyboard.press('Meta+Enter');
  const previewCaret = tauriPage.locator('.peekmd-preview-caret');
  await expect(previewCaret).toBeVisible();
  expect(await previewCaret.evaluate((element: Element) => {
    const selection = element.ownerDocument.getSelection();
    return { text: selection?.anchorNode?.textContent, offset: selection?.anchorOffset };
  })).toEqual({ text: ' and an image: ', offset: 4 });

  await tauriPage.keyboard.press('Meta+Enter');
  await tauriPage.keyboard.type('|');
  await expect(mixedLine).toContainText('`inline code` and| an image:');
});

test('preserves native text selection instead of replacing it with a preview cursor', async ({ tauriPage }) => {
  const text = tauriPage.locator('.markdown-body span[data-sourcepos="3:1-3:12"]');
  const box = await text.boundingBox();
  expect(box).not.toBeNull();
  await tauriPage.mouse.move(box!.x + 2, box!.y + box!.height / 2);
  await tauriPage.mouse.down();
  await tauriPage.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2, { steps: 5 });
  await tauriPage.mouse.up();
  expect(await tauriPage.evaluate<string>('window.getSelection()?.toString() ?? ""')).toContain('ntro block');
  await expect(tauriPage.locator('.peekmd-preview-caret')).toBeHidden();
});

test('clears stale cursors and expires an unmappable blank-line restore', async ({ tauriPage }) => {
  await tauriPage.keyboard.press('Meta+Enter');
  const editor = tauriPage.locator('.cm-content');
  await tauriPage.locator('.cm-line').nth(1).click();
  await editor.press('Home');
  await tauriPage.keyboard.press('Meta+Enter');
  await tauriPage.locator('body').evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));

  await tauriPage.locator('.markdown-body span[data-sourcepos="3:1-3:12"]').click();
  await expect(tauriPage.locator('.peekmd-preview-caret')).toBeVisible();
  await tauriPage.evaluate(`(() => {
    const current = Reflect.get(globalThis, '__editDocument');
    Reflect.set(globalThis, '__editDocument', {
      ...current,
      html: '<p data-sourcepos="2:1-2:5">Blank now</p><p data-sourcepos="3:1-3:12"><span data-sourcepos="3:1-3:12">Intro block.</span></p>',
      revision: { ...current.revision, sha256: 'reloaded' },
    });
  })()`);
  await tauriPage.keyboard.press('Meta+r');
  await expect(tauriPage.getByText('Blank now')).toBeVisible();
  await tauriPage.locator('body').evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
  await expect(tauriPage.locator('.peekmd-preview-caret')).toBeHidden();
  expect(await tauriPage.evaluate<number>('window.getSelection()?.rangeCount ?? -1')).toBe(0);
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
