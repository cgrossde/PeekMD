import { test, expect } from '../edit-mode-fixtures';

test('exposes semantic cursor state and exact bridge controls', async ({ tauriPage }) => {
  const initial = await tauriPage.evaluate<any>('window.__PEEKMD_DEBUG__?.getState() ?? null');
  expect(initial?.mode).toBe('preview');
  expect(initial?.activeDocument?.path).toBe('/tmp/peekmd-edit-fixture.md');

  expect(await tauriPage.evaluate<boolean>(`window.__PEEKMD_DEBUG__?.setPreviewCursor('span[data-sourcepos="3:1-3:12"]', 2) ?? false`)).toBe(true);
  const preview = await tauriPage.evaluate<any>('window.__PEEKMD_DEBUG__?.getState() ?? null');
  expect(preview.previewCursor?.renderedOffset).toBe(2);

  expect(await tauriPage.evaluate<boolean>('window.__PEEKMD_DEBUG__?.toggleEditMode() ?? false')).toBe(true);
  await expect(tauriPage.locator('.cm-editor')).toBeVisible();
  expect(await tauriPage.evaluate<boolean>(`window.__PEEKMD_DEBUG__?.setEditorCursor({ line: 3, column: 4 }) ?? false`)).toBe(true);
  expect(await tauriPage.evaluate<any>('window.__PEEKMD_DEBUG__?.getState().editorCursor ?? null')).toEqual({ offset: 22, line: 3, column: 4 });
  expect(await tauriPage.evaluate<boolean>('window.__PEEKMD_DEBUG__?.toggleEditMode() ?? false')).toBe(true);
  await expect(tauriPage.locator('.markdown-body')).toBeVisible();
});

test('rejects invalid cursor requests and clears a cursor after refresh', async ({ tauriPage }) => {
  expect(await tauriPage.evaluate<boolean>(`window.__PEEKMD_DEBUG__?.setPreviewCursor('.does-not-exist', 0) ?? false`)).toBe(false);
  expect(await tauriPage.evaluate<boolean>(`window.__PEEKMD_DEBUG__?.setPreviewCursor('span[data-sourcepos="3:1-3:12"]', 999) ?? false`)).toBe(false);
  expect(await tauriPage.evaluate<boolean>(`window.__PEEKMD_DEBUG__?.setPreviewCursor('span[data-sourcepos="3:1-3:12"]', 1) ?? false`)).toBe(true);

  await tauriPage.evaluate(`(() => {
    const current = Reflect.get(globalThis, '__editDocument');
    Reflect.set(globalThis, '__editDocument', { ...current, html: '<p data-sourcepos="3:1-3:12"><span data-sourcepos="3:1-3:12">Refreshed.</span></p>', revision: { ...current.revision, sha256: 'debug-refresh' } });
  })()`);
  await tauriPage.evaluate('window.__PEEKMD_DEBUG__?.refreshActive()');
  await tauriPage.evaluate('(() => { const { promise, resolve } = Promise.withResolvers(); requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))); return promise; })()');
  const state = await tauriPage.evaluate<any>('window.__PEEKMD_DEBUG__?.getState() ?? null');
  expect(state.previewCursor).toBeNull();
  expect(await tauriPage.evaluate<number>('window.getSelection()?.rangeCount ?? 0')).toBe(0);
});
