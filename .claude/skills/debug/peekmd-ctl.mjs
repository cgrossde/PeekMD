#!/usr/bin/env node
/**
 * peekmd-ctl — thin CLI over the tauri-plugin-playwright Unix socket.
 *
 * Usage:
 *   node peekmd-ctl.mjs ping
 *   node peekmd-ctl.mjs screenshot [/abs/path/out.png]
 *   node peekmd-ctl.mjs screenshot-native [/abs/path/out.png]
 *   node peekmd-ctl.mjs click <css-selector>
 *   node peekmd-ctl.mjs fill <css-selector> <text>
 *   node peekmd-ctl.mjs press <key> [css-selector]
 *   node peekmd-ctl.mjs cursor-state
 *   node peekmd-ctl.mjs cursor-roundtrip
 *   node peekmd-ctl.mjs eval <js-expression>
 *   node peekmd-ctl.mjs content
 *   node peekmd-ctl.mjs dom <css-selector>
 *   node peekmd-ctl.mjs style <css-selector> <css-property>
 *   node peekmd-ctl.mjs theme
 *   node peekmd-ctl.mjs path
 *   node peekmd-ctl.mjs html
 *
 * Exits 0 on success, 1 on error.
 * screenshot / screenshot-native: prints the resolved file path to stdout.
 * eval / text queries: prints the result value to stdout.
 */

import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';

const SOCKET = '/tmp/tauri-playwright.sock';
const TIMEOUT_MS = 10_000;

// ── helpers ────────────────────────────────────────────────────────────────

function send(cmd) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SOCKET)) {
      reject(new Error(
        `Socket not found: ${SOCKET}\n` +
        `Is PeekMD running in dev mode? Run: bun run tauri dev -- -- /path/to/file.md`
      ));
      return;
    }

    const sock = net.createConnection(SOCKET);
    let buf = '';
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`Timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    sock.on('connect', () => sock.write(JSON.stringify(cmd) + '\n'));
    sock.on('data', chunk => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(timer);
        sock.destroy();
        try {
          resolve(JSON.parse(buf.slice(0, nl)));
        } catch (e) {
          reject(new Error(`Bad response: ${buf.slice(0, nl)}`));
        }
      }
    });
    sock.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

async function ping() {
  const r = await send({ type: 'ping' });
  if (!r.ok) throw new Error(r.error ?? 'ping failed');
  return 'pong';
}

// Webview-only screenshot (DOM pixels, no window chrome)
async function screenshot(outPath) {
  const resolved = outPath
    ? path.resolve(outPath)
    : path.join(os.tmpdir(), `peekmd-${Date.now()}.png`);
  const r = await send({ type: 'screenshot', path: resolved });
  if (!r.ok) throw new Error(r.error ?? 'screenshot failed');
  return resolved;
}

// Native macOS screenshot (retina, includes window chrome and shadow)
async function screenshotNative(outPath) {
  const resolved = outPath
    ? path.resolve(outPath)
    : path.join(os.tmpdir(), `peekmd-native-${Date.now()}.png`);
  const r = await send({ type: 'native_screenshot', path: resolved });
  if (!r.ok) throw new Error(r.error ?? 'native screenshot failed');
  return resolved;
}

async function click(selector) {
  const r = await send({ type: 'click', selector, timeout_ms: 5000 });
  if (!r.ok) throw new Error(r.error ?? 'click failed');
}

async function fill(selector, text) {
  const r = await send({ type: 'fill', selector, text, timeout_ms: 5000 });
  if (!r.ok) throw new Error(r.error ?? 'fill failed');
}

async function press(key, selector) {
  const parts = key.split('+');
  const mainKey = parts.pop();
  const modifiers = new Set(parts.map(part => part === 'ControlOrMeta' ? 'Meta' : part));
  const target = selector
    ? `document.querySelector(${JSON.stringify(selector)})`
    : `document.body`;
  await evaluate(`(function () {
    const element = ${target};
    if (!element) throw new Error('Key target not found');
    element.focus();
    const modifierKeys = ${JSON.stringify([...modifiers])};
    for (const modifier of modifierKeys) element.dispatchEvent(new KeyboardEvent('keydown', { key: modifier, bubbles: true }));
    const options = { key: ${JSON.stringify(mainKey)}, bubbles: true, ctrlKey: ${modifiers.has('Control')}, shiftKey: ${modifiers.has('Shift')}, altKey: ${modifiers.has('Alt')}, metaKey: ${modifiers.has('Meta')} };
    element.dispatchEvent(new KeyboardEvent('keydown', options));
    element.dispatchEvent(new KeyboardEvent('keypress', options));
    element.dispatchEvent(new KeyboardEvent('keyup', options));
    for (const modifier of modifierKeys) element.dispatchEvent(new KeyboardEvent('keyup', { key: modifier, bubbles: true }));
  })()`);
}

async function evaluate(script) {
  const r = await send({ type: 'eval', script });
  if (!r.ok) throw new Error(r.error ?? 'eval failed');
  return r.result ?? r.data ?? JSON.stringify(r);
}

async function content() {
  const r = await send({ type: 'content' });
  if (!r.ok) throw new Error(r.error ?? 'content failed');
  return r.result ?? r.data ?? '';
}

async function dom(selector) {
  const r = await send({ type: 'inner_html', selector, timeout_ms: 5000 });
  if (!r.ok) throw new Error(r.error ?? 'dom query failed');
  return r.result ?? r.data ?? '';
}

async function style(selector, property) {
  const r = await send({ type: 'get_computed_style', selector, property, timeout_ms: 5000 });
  if (!r.ok) throw new Error(r.error ?? 'style query failed');
  return r.result ?? r.data ?? '';
}

// PeekMD-specific convenience queries

async function theme() {
  return evaluate(`document.documentElement.dataset.theme`);
}

async function currentPath() {
  return evaluate(`document.querySelector('.peekmd-topbar')?.textContent?.trim()`);
}

async function renderedHtml() {
  return evaluate(`document.querySelector('.markdown-body')?.innerHTML ?? ''`);
}

async function cursorState() {
  return evaluate(`JSON.stringify((function () {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    const anchorElement = anchorNode?.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode?.parentElement;
    const sourceElement = anchorElement?.closest?.('[data-sourcepos]') ?? null;
    const caret = document.querySelector('.peekmd-preview-caret');
    const editorHost = document.querySelector('.peekmd-editor');
    const editorCursor = document.querySelector('.cm-cursor');
    const active = document.activeElement;
    const rect = element => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    return {
      mode: document.querySelector('.cm-editor') ? 'editor' : 'preview',
      activeElement: active ? { tag: active.tagName.toLowerCase(), className: active.className || null, role: active.getAttribute('role') } : null,
      selection: selection ? { collapsed: selection.isCollapsed, anchorOffset: selection.anchorOffset, focusOffset: selection.focusOffset, sourcePosition: sourceElement?.getAttribute('data-sourcepos') ?? null } : null,
      previewCaret: caret ? { hidden: caret.hidden, rect: rect(caret), left: caret.style.left, top: caret.style.top, height: caret.style.height } : null,
      editorCursor: editorHost ? { offset: Number(editorHost.dataset.cursorOffset), rect: rect(editorCursor), lineText: anchorElement?.closest?.('.cm-line')?.textContent ?? null } : null,
    };
  })())`);
}

async function debugToggleEditMode() {
  await press('Meta+Enter', 'body');
}

async function waitForTransition(mode, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = JSON.parse(await cursorState());
    const previewReady = mode !== 'preview' || state.previewCaret?.hidden === false;
    if (state.mode === mode && previewReady) return state;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${mode} cursor state`);
}

async function cursorRoundtrip() {
  const before = JSON.parse(await cursorState());
  const switchedMode = before.mode === 'preview' ? 'editor' : 'preview';
  await debugToggleEditMode();
  const switched = await waitForTransition(switchedMode);
  await debugToggleEditMode();
  const returned = await waitForTransition(before.mode);
  return JSON.stringify({ before, switched, returned }, null, 2);
}

// ── CLI ────────────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

(async () => {
  switch (cmd) {
    case 'ping': {
      console.log(await ping());
      break;
    }
    case 'screenshot': {
      const p = await screenshot(args[0]);
      console.log(p);
      break;
    }
    case 'screenshot-native': {
      const p = await screenshotNative(args[0]);
      console.log(p);
      break;
    }
    case 'click': {
      if (!args[0]) throw new Error('Usage: click <selector>');
      await click(args[0]);
      console.log('ok');
      break;
    }
    case 'fill': {
      if (args.length < 2) throw new Error('Usage: fill <selector> <text>');
      await fill(args[0], args.slice(1).join(' '));
      console.log('ok');
      break;
    }
    case 'press': {
      if (!args[0]) throw new Error('Usage: press <key> [css-selector]');
      await press(args[0], args[1]);
      console.log('ok');
      break;
    }
    case 'eval': {
      if (!args[0]) throw new Error('Usage: eval <script>');
      const result = await evaluate(args.join(' '));
      console.log(result);
      break;
    }
    case 'content': {
      console.log(await content());
      break;
    }
    case 'dom': {
      if (!args[0]) throw new Error('Usage: dom <selector>');
      console.log(await dom(args[0]));
      break;
    }
    case 'style': {
      if (args.length < 2) throw new Error('Usage: style <selector> <css-property>');
      console.log(await style(args[0], args.slice(1).join('-')));
      break;
    }
    case 'theme': {
      console.log(await theme());
      break;
    }
    case 'path': {
      console.log(await currentPath());
      break;
    }
    case 'html': {
      console.log(await renderedHtml());
      break;
    }
    case 'cursor-state': {
      console.log(await cursorState());
      break;
    }
    case 'cursor-roundtrip': {
      console.log(await cursorRoundtrip());
      break;
    }
    default:
      console.error(`Unknown command: ${cmd ?? '(none)'}`);
      console.error('Commands: ping, screenshot, screenshot-native, click, fill, press, eval,');
      console.error('          content, dom, style, theme, path, html, cursor-state, cursor-roundtrip');
      process.exit(1);
  }
})().catch(e => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
