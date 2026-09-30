import net from 'node:net';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const SOCKET = '/tmp/tauri-playwright.sock';
export const DEFAULT_WAIT_MS = 2000;
export const MANIFEST_PATH = path.join(os.tmpdir(), 'peekmd-debug-fixture.json');
const FIXTURE_PREFIX = path.join(os.tmpdir(), 'peekmd-debug-');
const execFileAsync = promisify(execFile);

function responseValue(response) {
  if (!response?.ok) throw new Error(response?.error ?? 'PeekMD command failed');
  return response.result ?? response.data;
}

export function createSocketTransport({ socket = SOCKET, timeoutMs = 10000, verbose = false, stderr = process.stderr } = {}) {
  return command => {
    const { promise, resolve, reject } = Promise.withResolvers();
    if (!fs.existsSync(socket)) {
      reject(new Error(`Socket not found: ${socket}\nIs PeekMD running in dev mode? Run: bun run tauri dev -- -- /path/to/file.md`));
      return promise;
    }
    const sock = net.createConnection(socket);
    let buffer = '';
    const log = (label, value) => { if (verbose) stderr.write(`[peekmd] ${label} ${JSON.stringify(value)}\n`); };
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`Timeout after ${timeoutMs}ms`)); }, timeoutMs);
    log('request', command);
    sock.on('connect', () => sock.write(JSON.stringify(command) + '\n'));
    sock.on('data', chunk => {
      buffer += chunk.toString();
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      sock.destroy();
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        log('response', response);
        resolve(response);
      } catch {
        reject(new Error(`Bad response: ${buffer.slice(0, newline)}`));
      }
    });
    sock.on('error', error => { clearTimeout(timer); reject(error); });
    return promise;
  };
}

function parseJsonResult(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function rectOf(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

const cursorStateScript = `JSON.stringify((() => {
  const bridge = window.__PEEKMD_DEBUG__;
  if (!bridge) throw new Error('PeekMD debug bridge unavailable; run a development build');
  const snapshot = bridge.getState();
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode ?? null;
  const anchorElement = anchorNode?.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode?.parentElement;
  const sourceElement = anchorElement?.closest?.('[data-sourcepos]') ?? null;
  const caret = document.querySelector('.peekmd-preview-caret');
  const editorCursor = document.querySelector('.cm-cursor');
  const active = document.activeElement;
  return {
    ...snapshot,
    activeElement: active ? { tag: active.tagName.toLowerCase(), className: active.className || null, role: active.getAttribute('role') } : null,
    selection: selection ? { collapsed: selection.isCollapsed, anchorOffset: selection.anchorOffset, focusOffset: selection.focusOffset, text: selection.toString(), sourcePosition: sourceElement?.getAttribute('data-sourcepos') ?? null } : null,
    previewCaret: caret ? { hidden: caret.hidden, rect: (${rectOf.toString()})(caret), left: caret.style.left, top: caret.style.top, height: caret.style.height } : null,
    editorCursorRect: (${rectOf.toString()})(editorCursor)
  };
})())`;

function delay(ms) {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(resolve, ms);
  return promise;
}

export function createPeekMdClient({ send, sleep = delay, now = () => Date.now(), stderr = process.stderr, manifestPath = MANIFEST_PATH, fixturePrefix = FIXTURE_PREFIX } = {}) {
  if (typeof send !== 'function') throw new TypeError('createPeekMdClient requires a send(command) transport');
  const request = async command => responseValue(await send(command));
  const evaluate = async script => request({ type: 'eval', script });
  const evaluateJson = async script => parseJsonResult(await evaluate(script));
  const bridgeCall = (method, args = []) => evaluateJson(`(async () => {
    const bridge = window.__PEEKMD_DEBUG__;
    if (!bridge) throw new Error('PeekMD debug bridge unavailable; run a development build');
    return await bridge[${JSON.stringify(method)}](...${JSON.stringify(args)});
  })()`);

  const getState = async () => {
    const state = await evaluateJson(`JSON.stringify((() => {
      const bridge = window.__PEEKMD_DEBUG__;
      if (!bridge) throw new Error('PeekMD debug bridge unavailable; run a development build');
      return bridge.getState();
    })())`);
    if (!state || typeof state !== 'object') throw new Error('PeekMD debug bridge returned invalid state');
    return state;
  };

  async function cursorState() { return evaluateJson(cursorStateScript); }
  async function waitFor(predicate, description, timeoutMs = DEFAULT_WAIT_MS) {
    const deadline = now() + timeoutMs;
    let state = null;
    while (now() <= deadline) {
      state = await getState();
      if (await predicate(state)) return state;
      await sleep(25);
    }
    const error = new Error(`Timed out waiting for ${description}; final state: ${JSON.stringify(state)}`);
    error.state = state;
    throw error;
  }

  async function waitMode(mode, timeoutMs) { return waitFor(state => state.mode === mode, `mode ${mode}`, timeoutMs); }
  async function waitEditStatus(status, timeoutMs) { return waitFor(state => state.editSession?.status === status, `edit status ${status}`, timeoutMs); }
  async function waitSelector(selector, timeoutMs) {
    return waitFor(async () => Boolean(await evaluateJson(`(() => { try { return Boolean(document.querySelector(${JSON.stringify(selector)})); } catch { return false; } })()`)), `selector ${selector}`, timeoutMs);
  }
  async function waitCursorVisible(timeoutMs) {
    return waitFor(async () => Boolean(await evaluateJson(`(() => {
      const preview = document.querySelector('.peekmd-preview-caret');
      if (preview && !preview.hidden && preview.getBoundingClientRect().height > 0) return true;
      const editor = document.querySelector('.cm-cursor');
      return Boolean(editor && editor.getBoundingClientRect().height > 0);
    })()`)), 'cursor-visible', timeoutMs);
  }

  async function setEditorCursor(input) {
    const result = await bridgeCall('setEditorCursor', [input]);
    if (result !== true) throw new Error('Editor cursor rejected by the debug bridge');
    return cursorState();
  }
  async function setPreviewCursor(selector, offset) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Preview offset must be a non-negative integer');
    const result = await bridgeCall('setPreviewCursor', [selector, offset]);
    if (result !== true) throw new Error('Preview cursor rejected by the debug bridge');
    await waitCursorVisible();
    return cursorState();
  }
  async function toggleEditMode() {
    const result = await bridgeCall('toggleEditMode');
    if (result !== true) throw new Error('Edit-mode transition was rejected by the debug bridge');
    return result;
  }

  async function fixtureRecord() {
    try { return JSON.parse(await fsp.readFile(manifestPath, 'utf8')); } catch { return null; }
  }
  function assertOwnedFixture(record) {
    if (!record || typeof record.path !== 'string' || typeof record.directory !== 'string' || !record.path.startsWith(record.directory + path.sep) || !record.directory.startsWith(fixturePrefix)) {
      throw new Error('No active owned fixture');
    }
  }
  async function openFixture() {
    const existing = await fixtureRecord();
    if (existing) assertOwnedFixture(existing);
    if (!existing) {
      const directory = await fsp.mkdtemp(fixturePrefix);
      const fixture = path.join(directory, 'fixture.md');
      await fsp.copyFile(new URL('./fixtures/cursor.md', import.meta.url), fixture);
      await fsp.writeFile(manifestPath, JSON.stringify({ directory, path: fixture }, null, 2));
    }
    const record = await fixtureRecord();
    await bridgeCall('openFile', [record.path]);
    await waitFor(state => state.activeDocument?.path === record.path, `fixture ${record.path}`);
    return record;
  }
  async function replaceFixture(text) {
    const record = await fixtureRecord();
    assertOwnedFixture(record);
    const active = (await getState()).activeDocument;
    if (active?.path !== record.path) throw new Error('Owned fixture is not the active document');
    const before = active.revision;
    await fsp.writeFile(record.path, text);
    await bridgeCall('refreshActive');
    await waitFor(state => state.activeDocument?.path === record.path && JSON.stringify(state.activeDocument.revision) !== JSON.stringify(before), 'fixture revision change');
    return record;
  }
  async function cleanupFixture() {
    const record = await fixtureRecord();
    if (!record) throw new Error('Fixture manifest is absent');
    assertOwnedFixture(record);
    await bridgeCall('closeDocument', [record.path]);
    await fsp.rm(record.directory, { recursive: true, force: false });
    await fsp.rm(manifestPath, { force: false });
    return true;
  }

  async function cursorRoundtrip(selector = 'p[data-sourcepos="9:1-9:53"]', offset = 15) {
    let created = false;
    const existing = await fixtureRecord();
    let record = existing;
    try {
      if (!existing) created = true;
      record = await openFixture();
      await waitFor(state => state.activeDocument?.path === record.path, 'fixture active');
      const before = await setPreviewCursor(selector, offset);
      await toggleEditMode();
      const switched = await waitMode('editor');
      const expectedSourceOffset = switched.editorCursor?.offset;
      if (expectedSourceOffset === undefined) throw new Error('Editor cursor was unavailable after entering edit mode');
      await toggleEditMode();
      const returned = await waitFor(state => state.mode === 'preview' && state.previewCursor?.renderedOffset === offset && state.previewCursor?.sourceOffset === expectedSourceOffset, 'preview cursor restoration');
      await waitCursorVisible();
      const final = await cursorState();
      return { before, switched, returned: final };
    } finally {
      if (created) await cleanupFixture();
    }
  }

  async function liveReload() {
    let created = false;
    const existing = await fixtureRecord();
    let record = existing;
    try {
      if (!existing) created = true;
      record = await openFixture();
      await setPreviewCursor('p[data-sourcepos="9:1-9:53"]', 15);
      await replaceFixture('# Reloaded fixture\n\nChanged content.\n');
      const state = await waitFor(snapshot => snapshot.previewCursor === null && snapshot.pendingPreviewCursor === null, 'stale cursor clear');
      const dom = await cursorState();
      if (dom.selection && !dom.selection.collapsed) throw new Error('Native selection remained after reload');
      if (dom.previewCaret && !dom.previewCaret.hidden) throw new Error('Preview caret remained after reload');
      return state;
    } finally {
      if (created) await cleanupFixture();
    }
  }

  async function selectionDrag() {
    const result = await execFileAsync('bunx', ['playwright', 'test', 'e2e/tests/edit-mode.spec.ts', '--project=browser', '-g', 'preserves native text selection instead of replacing it with a preview cursor'], { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 });
    return { coverage: 'browser-e2e-native-selection', output: `${result.stdout}${result.stderr}` };
  }

  async function diagnoseCursor(outputDirectory) {
    const output = outputDirectory
      ? path.resolve(outputDirectory)
      : path.join(os.tmpdir(), `peekmd-diagnostic-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`);
    await fsp.mkdir(output, { recursive: true });
    if ((await fsp.readdir(output)).length !== 0) throw new Error('Diagnostic output directory must be empty');
    const files = { state: 'state.json', console: 'console.json', html: 'rendered.html', screenshot: 'screenshot.png', log: 'app.log' };
    const captures = await Promise.allSettled([
      (async () => { const state = await getState(); await fsp.writeFile(path.join(output, files.state), JSON.stringify(state, null, 2)); return state; })(),
      (async () => { const entries = await bridgeCall('getConsoleEntries'); await fsp.writeFile(path.join(output, files.console), JSON.stringify(entries, null, 2)); return entries; })(),
      (async () => { const html = await evaluate(`document.querySelector('.markdown-body')?.innerHTML ?? ''`); await fsp.writeFile(path.join(output, files.html), String(html)); return html; })(),
      (async () => { await request({ type: 'native_screenshot', path: path.join(output, files.screenshot) }); return files.screenshot; })(),
      (async () => {
        const logDir = path.join(os.homedir(), 'Library/Logs/PeekMD Dev');
        const names = (await fsp.readdir(logDir)).filter(name => name.startsWith('peekmd') && name.endsWith('.log'));
        if (names.length === 0) throw new Error('No PeekMD log file found');
        const newest = (await Promise.all(names.map(async name => ({ name, stat: await fsp.stat(path.join(logDir, name)) })))).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0].name;
        const lines = (await fsp.readFile(path.join(logDir, newest), 'utf8')).split(/\r?\n/).filter(Boolean).slice(-200);
        await fsp.writeFile(path.join(output, files.log), lines.join('\n') + (lines.length ? '\n' : ''));
        return newest;
      })(),
    ]);
    const names = ['state', 'console', 'html', 'screenshot', 'log'];
    const stateCapture = captures[0];
    const summary = { utc: new Date().toISOString(), mode: stateCapture.status === 'fulfilled' ? stateCapture.value.mode : null, success: true, captures: {} };
    for (let index = 0; index < captures.length; index += 1) {
      const capture = captures[index];
      summary.captures[names[index]] = capture.status === 'fulfilled' ? { ok: true, file: files[names[index]] } : { ok: false, error: String(capture.reason?.message ?? capture.reason) };
      if (capture.status === 'rejected' && (names[index] === 'state' || names[index] === 'screenshot')) summary.success = false;
    }
    await fsp.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
    return { directory: output, summary };
  }

  return {
    request, evaluate, getState, cursorState, waitMode, waitEditStatus, waitSelector, waitCursorVisible,
    setEditorCursor, setPreviewCursor, toggleEditMode, openFixture, replaceFixture, cleanupFixture,
    cursorRoundtrip, liveReload, selectionDrag, diagnoseCursor,
    ping: async () => { const result = await request({ type: 'ping' }); return result === undefined ? 'pong' : result; },
    screenshot: async outPath => { const resolved = path.resolve(outPath ?? path.join(os.tmpdir(), `peekmd-${Date.now()}.png`)); await request({ type: 'screenshot', path: resolved }); return resolved; },
    screenshotNative: async outPath => { const resolved = path.resolve(outPath ?? path.join(os.tmpdir(), `peekmd-native-${Date.now()}.png`)); await request({ type: 'native_screenshot', path: resolved }); return resolved; },
    click: selector => request({ type: 'click', selector, timeout_ms: 5000 }),
    fill: (selector, text) => request({ type: 'fill', selector, text, timeout_ms: 5000 }),
    press: async (key, selector) => {
      const parts = key.split('+');
      const mainKey = parts.pop();
      const modifiers = new Set(parts.map(part => part === 'ControlOrMeta' ? 'Meta' : part));
      const target = selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.body';
      return evaluate(`(function () { const element = ${target}; if (!element) throw new Error('Key target not found'); element.focus(); const options = { key: ${JSON.stringify(mainKey)}, bubbles: true, ctrlKey: ${modifiers.has('Control')}, shiftKey: ${modifiers.has('Shift')}, altKey: ${modifiers.has('Alt')}, metaKey: ${modifiers.has('Meta')} }; element.dispatchEvent(new KeyboardEvent('keydown', options)); element.dispatchEvent(new KeyboardEvent('keypress', options)); element.dispatchEvent(new KeyboardEvent('keyup', options)); })()`);
    },
    content: () => request({ type: 'content' }),
    dom: selector => request({ type: 'inner_html', selector, timeout_ms: 5000 }),
    style: (selector, property) => request({ type: 'get_computed_style', selector, property, timeout_ms: 5000 }),
    theme: () => evaluate('document.documentElement.dataset.theme'),
    path: () => evaluate("document.querySelector('.peekmd-topbar')?.textContent?.trim()"),
    html: () => evaluate("document.querySelector('.markdown-body')?.innerHTML ?? ''"),
  };
}

export function parseCliArgs(argv) {
  const options = { json: false, verbose: false, timeout: DEFAULT_WAIT_MS };
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--timeout') {
      const value = Number(argv[++index]);
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('--timeout requires a non-negative integer');
      options.timeout = value;
    } else args.push(arg);
  }
  return { options, args };
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}
function requireInteger(value, label, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
  return number;
}

export async function dispatch(client, args, options = {}) {
  const timeout = options.timeout ?? DEFAULT_WAIT_MS;
  const [command, subcommand, ...rest] = args;
  const key = ['fixture', 'scenario', 'diagnose'].includes(command) ? `${command ?? ''} ${subcommand ?? ''}`.trim() : command;
  switch (key) {
    case 'ping': return client.ping();
    case 'screenshot': return client.screenshot(rest[0] ?? subcommand);
    case 'screenshot-native': return client.screenshotNative(rest[0] ?? subcommand);
    case 'click': if (!subcommand) throw new Error('Usage: click <selector>'); return client.click(subcommand);
    case 'fill': if (!subcommand || rest.length === 0) throw new Error('Usage: fill <selector> <text>'); return client.fill(subcommand, rest.join(' '));
    case 'press': if (!subcommand) throw new Error('Usage: press <key> [css-selector]'); return client.press(subcommand, rest[0]);
    case 'eval': if (!subcommand) throw new Error('Usage: eval <script>'); return client.evaluate([subcommand, ...rest].join(' '));
    case 'content': return client.content();
    case 'dom': if (!subcommand) throw new Error('Usage: dom <selector>'); return client.dom(subcommand);
    case 'style': if (!subcommand || rest.length === 0) throw new Error('Usage: style <selector> <css-property>'); return client.style(subcommand, rest.join('-'));
    case 'theme': return client.theme();
    case 'path': return client.path();
    case 'html': return client.html();
    case 'cursor-state': return client.cursorState();
    case 'set-editor-cursor': {
      const offset = valueAfter(args, '--offset');
      const line = valueAfter(args, '--line');
      const column = valueAfter(args, '--column');
      if ((offset !== undefined) === (line !== undefined || column !== undefined) || (line !== undefined) !== (column !== undefined)) throw new Error('Use exactly one of --offset N or --line N --column N');
      return client.setEditorCursor(offset !== undefined ? { offset: requireInteger(offset, 'offset') } : { line: requireInteger(line, 'line', 1), column: requireInteger(column, 'column', 1) });
    }
    case 'set-preview-cursor': {
      const selector = valueAfter(args, '--selector');
      if (!selector) throw new Error('Usage: set-preview-cursor --selector CSS --offset N');
      return client.setPreviewCursor(selector, requireInteger(valueAfter(args, '--offset'), 'offset'));
    }
    case 'wait':
      if (subcommand === 'mode') {
        if (!['empty', 'preview', 'editor'].includes(rest[0])) throw new Error('Usage: wait mode <empty|preview|editor>');
        return client.waitMode(rest[0], timeout);
      }
      if (subcommand === 'edit-status') {
        if (!['clean', 'dirty', 'saving', 'conflict', 'error'].includes(rest[0])) throw new Error('Usage: wait edit-status <clean|dirty|saving|conflict|error>');
        return client.waitEditStatus(rest[0], timeout);
      }
      if (subcommand === 'selector') {
        if (!rest[0]) throw new Error('Usage: wait selector <css>');
        return client.waitSelector(rest[0], timeout);
      }
      if (subcommand === 'cursor-visible') return client.waitCursorVisible(timeout);
      throw new Error('Usage: wait mode|edit-status|selector|cursor-visible ...');
    case 'assert-cursor': {
      const state = await client.cursorState();
      const offset = valueAfter(args, '--editor-offset');
      const line = valueAfter(args, '--line');
      const column = valueAfter(args, '--column');
      const selector = valueAfter(args, '--preview-selector');
      const renderedOffset = valueAfter(args, '--rendered-offset');
      const forms = [offset !== undefined, line !== undefined || column !== undefined, selector !== undefined || renderedOffset !== undefined].filter(Boolean).length;
      if (forms !== 1 || ((line !== undefined) !== (column !== undefined)) || ((selector !== undefined) !== (renderedOffset !== undefined))) throw new Error('Use exactly one cursor assertion form');
      let expected; let actual;
      if (offset !== undefined) {
        if (state.mode !== 'editor') throw new Error(`Expected editor mode, got ${state.mode}`);
        expected = { offset: requireInteger(offset, 'offset') };
        actual = state.editorCursor;
        if (actual?.offset !== expected.offset) throw new Error(`Expected editor cursor ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      } else if (line !== undefined) {
        if (state.mode !== 'editor') throw new Error(`Expected editor mode, got ${state.mode}`);
        expected = { line: requireInteger(line, 'line', 1), column: requireInteger(column, 'column', 1) };
        actual = state.editorCursor;
        if (actual?.line !== expected.line || actual?.column !== expected.column) throw new Error(`Expected editor cursor ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      } else {
        if (state.mode !== 'preview') throw new Error(`Expected preview mode, got ${state.mode}`);
        expected = { selector, renderedOffset: requireInteger(renderedOffset, 'rendered offset') };
        actual = state.previewCursor;
        const selectorMatches = await client.evaluate(`(() => { try { const element = document.querySelector(${JSON.stringify(selector)}); const selection = window.getSelection(); return Boolean(element && selection?.anchorNode && element.contains(selection.anchorNode)); } catch { return false; } })()`);
        if (!actual || actual.renderedOffset !== expected.renderedOffset || selectorMatches !== true) throw new Error(`Expected preview cursor ${JSON.stringify(expected)}, got ${JSON.stringify({ cursor: actual, selectorMatches })}`);
      }
      return { expected, actual };
    }
    case 'fixture open': if (subcommand !== 'open' || rest[0] !== 'cursor') throw new Error('Usage: fixture open cursor'); return client.openFixture();
    case 'fixture replace': {
      if (subcommand !== 'replace') throw new Error('Usage: fixture replace --text TEXT|--from FILE');
      const text = valueAfter(args, '--text');
      const source = valueAfter(args, '--from');
      if ((text === undefined) === (source === undefined)) throw new Error('Use exactly one of --text TEXT or --from FILE');
      return client.replaceFixture(text ?? await fsp.readFile(path.resolve(source), 'utf8'));
    }
    case 'fixture cleanup': if (subcommand !== 'cleanup') throw new Error('Usage: fixture cleanup'); return client.cleanupFixture();
    case 'scenario cursor-roundtrip': {
      const selector = valueAfter(args, '--selector');
      const offset = valueAfter(args, '--offset');
      return client.cursorRoundtrip(selector ?? undefined, offset === undefined ? undefined : requireInteger(offset, 'offset'));
    }
    case 'scenario live-reload': return client.liveReload();
    case 'scenario selection-drag': return client.selectionDrag();
    case 'diagnose cursor': if (subcommand !== 'cursor') throw new Error('Usage: diagnose cursor [--output DIRECTORY]'); return client.diagnoseCursor(valueAfter(args, '--output'));
    default: throw new Error(`Unknown command: ${args.join(' ') || '(none)'}`);
  }
}

export async function runCli(argv, { send, stdout = process.stdout, stderr = process.stderr } = {}) {
  let options = { json: argv.includes('--json'), verbose: argv.includes('--verbose'), timeout: DEFAULT_WAIT_MS };
  let args = argv.filter(arg => arg !== '--json' && arg !== '--verbose');
  let command = args.slice(0, ['scenario', 'fixture', 'wait', 'diagnose'].includes(args[0]) ? 2 : 1).join(' ');
  let client;
  try {
    ({ options, args } = parseCliArgs(argv));
    command = args.slice(0, ['scenario', 'fixture', 'wait', 'diagnose'].includes(args[0]) ? 2 : 1).join(' ');
    const transport = send ?? createSocketTransport({ verbose: options.verbose, stderr });
    client = createPeekMdClient({ send: transport, stderr });
    const data = await dispatch(client, args, options);
    if (command === 'diagnose cursor' && data?.summary?.success === false) throw new Error(`Diagnostic capture failed; bundle: ${data.directory}`);
    if (options.json) stdout.write(JSON.stringify({ ok: true, command, data }, null, 2) + '\n');
    else stdout.write(typeof data === 'string' ? data + '\n' : JSON.stringify(data, null, 2) + '\n');
    return { ok: true, command, data };
  } catch (error) {
    let state;
    try { state = client ? await client.getState() : undefined; } catch { /* bridge/socket may be unavailable */ }
    const payload = { ok: false, command, error: String(error?.message ?? error), ...(state ? { state } : {}) };
    if (options.json) stdout.write(JSON.stringify(payload, null, 2) + '\n');
    else stderr.write(`Error: ${payload.error}\n`);
    return payload;
  }
}
