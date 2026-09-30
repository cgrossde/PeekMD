import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { markdownHrefAt } from './editorLinks';

function state(source: string): EditorState {
  return EditorState.create({ doc: source, extensions: [markdown({ base: markdownLanguage })] });
}

function href(source: string, needle: string): string | null {
  const start = source.indexOf(needle);
  return markdownHrefAt(state(source), start + Math.max(0, needle.length - 1));
}

describe('markdownHrefAt', () => {
  it('resolves inline and autolink destinations', () => {
    expect(href('[docs](guide\\ file.md)', 'docs')).toBe('guide file.md');
    expect(href('<https://example.test/a>', 'https://example')).toBe('https://example.test/a');
    expect(href('[angle](<guide.md>)', 'angle')).toBe('guide.md');
  });

  it('decodes escaped and entity destinations', () => {
    expect(href('[link](https://example.test/a\\(b\\))', 'link')).toBe('https://example.test/a(b)');
    expect(href('[link](https://example.test/?a=1&amp;b=2)', 'link')).toBe('https://example.test/?a=1&b=2');
  });

  it('resolves collapsed references with normalized labels', () => {
    const source = '[Read Me][]\n\n[read   me]: /docs/guide.md\n';
    expect(href(source, 'Read Me')).toBe('/docs/guide.md');
  });

  it('does not take a later inline destination for a reference link', () => {
    const source = '[Reference][]\n\n[Later](wrong.md)\n\n[reference]: right.md\n';
    expect(href(source, 'Reference')).toBe('right.md');
  });
});
