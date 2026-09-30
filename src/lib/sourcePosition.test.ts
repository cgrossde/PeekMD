import { Text } from '@codemirror/state';
import { domPointForSourceOffset } from '../components/MarkdownPreview';
import { capturePreviewAnchor, parseSourcePosition, parseSourceRange, previewCursorToOffset, restorePreviewAnchor } from './sourcePosition';

describe('source position anchors', () => {
  it('rejects malformed and inverted source ranges', () => {
    expect(parseSourcePosition('')).toBeNull();
    expect(parseSourcePosition('1:2')).toBeNull();
    expect(parseSourcePosition('x:1-2:3')).toBeNull();
    expect(parseSourcePosition('4:1-2:3')).toBeNull();
    expect(parseSourcePosition('2:1-4:9')).toEqual({ startLine: 2, endLine: 4 });
  });

  it('captures the first visible source block and its viewport offset', () => {
    const container = document.createElement('div');
    const first = document.createElement('p');
    first.setAttribute('data-sourcepos', '8:1-8:10');
    const second = document.createElement('p');
    second.setAttribute('data-sourcepos', '12:1-12:10');
    container.append(first, second);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ top: 92, bottom: 108 } as DOMRect);
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ top: 112, bottom: 128 } as DOMRect);
    expect(capturePreviewAnchor(container)).toEqual({ line: 8, offsetPx: -8 });
  });

  it('captures a source line within a partially visible multiline block', () => {
    const container = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.setAttribute('data-sourcepos', '10:1-13:20');
    container.append(paragraph);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue({ top: 60, bottom: 140, height: 80 } as DOMRect);
    expect(capturePreviewAnchor(container)).toEqual({ line: 12, offsetPx: 0 });
  });

  it('restores by containment, following block, then final preceding block', () => {
    const container = document.createElement('div');
    const blocks = ['1:1-3:1', '8:1-10:1', '20:1-22:1'].map(range => {
      const node = document.createElement('p');
      node.setAttribute('data-sourcepos', range);
      container.append(node);
      return node;
    });
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    blocks.forEach((node, index) => vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ top: 120 + index * 30 } as DOMRect));
    restorePreviewAnchor(container, { line: 9, offsetPx: 5 });
    expect(container.scrollTop).toBe(45);
    container.scrollTop = 0;
    restorePreviewAnchor(container, { line: 15, offsetPx: 5 });
    expect(container.scrollTop).toBe(75);
    container.scrollTop = 0;
    restorePreviewAnchor(container, { line: 30, offsetPx: 5 });
    expect(container.scrollTop).toBe(75);
  });

  it('restores to the estimated line position within a multiline block', () => {
    const container = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.setAttribute('data-sourcepos', '10:1-13:20');
    container.append(paragraph);
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue({ top: 60, bottom: 140, height: 80 } as DOMRect);
    restorePreviewAnchor(container, { line: 12, offsetPx: 0 });
    expect(container.scrollTop).toBe(0);
  });
});

describe('preview cursor source mapping', () => {
  it('maps visible plain text and Markdown punctuation to CodeMirror offsets', () => {
    const source = Text.of(['# Heading', '', '**bold** and [link](next.md)']);
    expect(previewCursorToOffset(source, { sourceRange: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 9 }, renderedText: 'Heading', renderedOffset: 3 })).toBe(5);
    expect(previewCursorToOffset(source, { sourceRange: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 8 }, renderedText: 'bold', renderedOffset: 2 })).toBe(15);
  });

  it('preserves an exact editor offset hidden by Markdown punctuation', () => {
    const source = Text.of(['[Reference][]']);
    expect(previewCursorToOffset(source, {
      sourceRange: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 13 },
      renderedText: 'Reference',
      renderedOffset: 9,
      sourceOffset: source.length,
    })).toBe(source.length);
  });

  it('maps a cursor inside plain text after an inline code span', () => {
    const line = '`inline code` and an image: ![alt](missing-image.png)';
    const source = Text.of([line]);
    const article = document.createElement('article');
    article.innerHTML = '<p data-sourcepos="1:1-1:53"><code data-sourcepos="1:1-1:13">inline code</code> and an image: <img data-sourcepos="1:29-1:53" alt="alt"></p>';
    const offset = line.indexOf(' and an image:') + ' and'.length;
    const point = domPointForSourceOffset(article, source, offset);
    expect(point?.node.data).toBe(' and an image: ');
    expect(point?.offset).toBe(4);
  });

  it('maps a clicked plain-text segment after inline Markdown', () => {
    const line = '`inline code` and an image: ![alt](missing-image.png)';
    const source = Text.of([line]);
    expect(previewCursorToOffset(source, {
      sourceRange: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 53 },
      renderedText: ' and an image: ',
      renderedOffset: 4,
    })).toBe(17);
  });
});
