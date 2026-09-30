import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPeekMdClient, parseCliArgs, runCli } from './peekmd-client.mjs';

const state = {
  mode: 'preview',
  activeDocument: { path: '/tmp/doc.md', title: 'doc', revision: { sha256: 'a', len: 1, file_id: '1' }, dirty: false },
  editSession: null,
  editorCursor: null,
  previewCursor: { sourceRange: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 }, renderedText: 'abc', renderedOffset: 1 },
  pendingPreviewCursor: null,
};

function fakeSend(overrides = {}) {
  return async command => {
    if (overrides[command.type]) return overrides[command.type](command);
    if (command.type === 'ping') return { ok: true, data: 'pong' };
    if (command.type === 'eval') {
      if (command.script.includes('getState')) return { ok: true, data: JSON.stringify(state) };
      if (command.script.includes('getConsoleEntries')) return { ok: true, data: [] };
      if (command.script.includes('closeDocument') || command.script.includes('openFile')) return { ok: true, data: true };
      if (command.script.includes('setPreviewCursor') || command.script.includes('setEditorCursor')) return { ok: true, data: true };
      return { ok: true, data: '{}' };
    }
    return { ok: true, data: true };
  };
}

test('parses global flags without changing command arguments', () => {
  assert.deepEqual(parseCliArgs(['--verbose', 'wait', 'mode', 'preview', '--timeout', '40', '--json']), {
    options: { json: true, verbose: true, timeout: 40 }, args: ['wait', 'mode', 'preview'],
  });
});

test('emits JSON success envelopes', async () => {
  const output = [];
  const result = await runCli(['ping', '--json'], { send: fakeSend(), stdout: { write: value => output.push(value) }, stderr: { write() {} } });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(output[0]), { ok: true, command: 'ping', data: 'pong' });
});

test('emits JSON failure envelopes for invalid options', async () => {
  const output = [];
  const result = await runCli(['ping', '--timeout', 'invalid', '--json'], { stdout: { write: value => output.push(value) }, stderr: { write() {} } });
  assert.equal(result.ok, false);
  assert.match(JSON.parse(output[0]).error, /--timeout requires/);
});

test('waits successfully and includes timeout diagnostics', async () => {
  const client = createPeekMdClient({ send: fakeSend() });
  assert.equal((await client.waitMode('preview', 10)).mode, 'preview');
  await assert.rejects(client.waitMode('editor', 0), error => error.message.includes('Timed out waiting for mode editor') && error.state.mode === 'preview');
});

test('reports assertion failures with expected and actual values', async () => {
  const client = createPeekMdClient({ send: fakeSend() });
  await assert.rejects(() => import('./peekmd-client.mjs').then(({ dispatch }) => dispatch(client, ['assert-cursor', '--editor-offset', '4'])), /Expected editor mode, got preview/);
});

test('rejects fixture operations without owned manifest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'peekmd-client-test-'));
  const client = createPeekMdClient({ send: fakeSend(), manifestPath: path.join(root, 'manifest.json'), fixturePrefix: path.join(root, 'fixture-') });
  await assert.rejects(client.replaceFixture('x'), /No active owned fixture/);
  await assert.rejects(client.cleanupFixture(), /Fixture manifest is absent/);
  await fs.rm(root, { recursive: true, force: true });
});

test('continues diagnostic collection after non-critical capture failure', async () => {
  const output = await fs.mkdtemp('/tmp/peekmd-test-diagnostic-');
  const client = createPeekMdClient({ send: fakeSend({ native_screenshot: () => ({ ok: false, error: 'screenshot unavailable' }) }) });
  const result = await client.diagnoseCursor(output);
  assert.equal(result.summary.success, false);
  assert.equal(result.summary.captures.screenshot.ok, false);
  assert.equal(result.summary.captures.state.ok, true);
  await fs.rm(output, { recursive: true, force: true });
});

test('cleans a created fixture after scenario failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'peekmd-client-test-'));
  const manifestPath = path.join(root, 'manifest.json');
  const fixturePrefix = path.join(root, 'fixture-');
  let activePath = null;
  let directory = null;
  let closeCalled = false;
  const send = async command => {
    if (command.type !== 'eval') return { ok: true, data: true };
    if (command.script.includes('"openFile"')) {
      const record = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      activePath = record.path;
      directory = record.directory;
      return { ok: true, data: true };
    }
    if (command.script.includes('"closeDocument"')) {
      closeCalled = true;
      return { ok: true, data: true };
    }
    if (command.script.includes('"setPreviewCursor"')) return { ok: true, data: false };
    if (command.script.includes('getState')) return { ok: true, data: JSON.stringify({ ...state, activeDocument: activePath ? { ...state.activeDocument, path: activePath } : state.activeDocument }) };
    return { ok: true, data: true };
  };
  const client = createPeekMdClient({ send, manifestPath, fixturePrefix });
  await assert.rejects(client.cursorRoundtrip(), /Preview cursor rejected/);
  assert.equal(closeCalled, true);
  assert.equal(typeof directory, 'string');
  await assert.rejects(fs.access(manifestPath));
  await assert.rejects(fs.access(directory));
  await fs.rm(root, { recursive: true, force: true });
});
