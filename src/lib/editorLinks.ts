import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

type TreeNode = { name: string; from: number; to: number; parent: TreeNode | null };

function decodeDestination(value: string): string {
  const unescaped = value.replace(/\\(.)/g, '$1');
  return unescaped.replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': '\u00a0' };
    const known = named[entity.toLowerCase()];
    if (known) return known;
    const numeric = /^&#x([0-9a-f]+);$/i.exec(entity) ?? /^&#(\d+);$/.exec(entity);
    return numeric ? String.fromCodePoint(parseInt(numeric[1], numeric[0].startsWith('&#x') ? 16 : 10)) : entity;
  });
}

function normalizeLabel(label: string): string {
  return decodeDestination(label).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function definitions(state: EditorState): Map<string, string> {
  const source = state.doc.toString();
  const result = new Map<string, string>();
  const definition = /^ {0,3}\[([^\]\n]+)\]:\s*(?:<([^>\n]*)>|([^\s\n]+))/gm;
  for (const match of source.matchAll(definition)) result.set(normalizeLabel(match[1]), decodeDestination(match[2] ?? match[3]));
  return result;
}

function inlineDestination(source: string): string | null {
  const open = source.indexOf('](');
  if (open < 0) return null;
  let value = '';
  let escaped = false;
  let angle = false;
  for (let i = open + 2; i < source.length; i++) {
    const char = source[i];
    if (escaped) { value += char; escaped = false; continue; }
    if (char === '\\') { value += char; escaped = true; continue; }
    if (char === '<' && value.trim() === '') { angle = true; value += char; continue; }
    if (char === '>' && angle) { angle = false; value += char; continue; }
    if (char === ')' && !angle) break;
    value += char;
  }
  return destination(value);
}

function destination(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('<')) {
    const end = value.indexOf('>');
    return end >= 0 ? decodeDestination(value.slice(1, end)) : null;
  }
  let result = '';
  let escaped = false;
  for (const char of value) {
    if (escaped) { result += `\\${char}`; escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (/\s/.test(char)) break;
    result += char;
  }
  return decodeDestination(result);
}

function nodeAt(state: EditorState, pos: number): TreeNode | null {
  let node: TreeNode | null = syntaxTree(state).resolve(pos, -1) as unknown as TreeNode;
  while (node) {
    if (node.name === 'Link' || node.name === 'LinkReference' || node.name === 'Autolink' || node.name === 'URL') return node;
    node = node.parent;
  }
  return null;
}

export function markdownHrefAt(state: EditorState, pos: number): string | null {
  const node = nodeAt(state, pos);
  if (!node) return null;
  const raw = state.sliceDoc(node.from, node.to);
  if (node.name === 'Autolink') return raw.startsWith('<') && raw.endsWith('>') ? decodeDestination(raw.slice(1, -1)) : decodeDestination(raw);
  if (node.name === 'URL') return decodeDestination(raw);
  if (node.name === 'Link') {
    const inline = inlineDestination(raw);
    if (inline) return inline;
    if (state.sliceDoc(node.to, node.to + 1) === '(') {
      const parentEnd = node.parent?.to ?? node.to;
      return inlineDestination(state.sliceDoc(node.from, parentEnd));
    }
  }
  if (node.name !== 'Link' && node.name !== 'LinkReference') return null;
  const reference = /^\[([^\]\n]*)\](?:\[([^\]\n]*)\])?/.exec(raw);
  if (!reference) return null;
  const label = reference[2] || reference[1];
  return definitions(state).get(normalizeLabel(label)) ?? null;
}
