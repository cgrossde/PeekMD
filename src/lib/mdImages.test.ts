import { describe, expect, it, vi, beforeEach } from 'vitest';

const convertFileSrc = vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`);
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc }));

const { resolveMarkdownImages } = await import('./mdImages');

function container(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('resolveMarkdownImages', () => {
  beforeEach(() => convertFileSrc.mockClear());

  it('rewrites a relative image path against the document directory', () => {
    const el = container('<img src="./img/shot.png">');
    resolveMarkdownImages(el, '/Users/alice/notes/README.md');
    expect(convertFileSrc).toHaveBeenCalledWith('/Users/alice/notes/img/shot.png');
    expect(el.querySelector('img')!.getAttribute('src')).toBe('asset://localhost/%2FUsers%2Falice%2Fnotes%2Fimg%2Fshot.png');
  });

  it('collapses ".." when resolving a relative path', () => {
    const el = container('<img src="../assets/logo.png">');
    resolveMarkdownImages(el, '/Users/alice/notes/sub/README.md');
    expect(convertFileSrc).toHaveBeenCalledWith('/Users/alice/notes/assets/logo.png');
  });

  it('leaves an absolute filesystem path as-is (no directory join)', () => {
    const el = container('<img src="/tmp/shot.png">');
    resolveMarkdownImages(el, '/Users/alice/notes/README.md');
    expect(convertFileSrc).toHaveBeenCalledWith('/tmp/shot.png');
  });

  it('strips a file:// prefix before converting', () => {
    const el = container('<img src="file:///Users/alice/shot.png">');
    resolveMarkdownImages(el, '/Users/alice/notes/README.md');
    expect(convertFileSrc).toHaveBeenCalledWith('/Users/alice/shot.png');
  });

  it('leaves http(s)/data/blob/asset URLs untouched', () => {
    const el = container(`
      <img id="a" src="https://example.com/x.png">
      <img id="b" src="data:image/png;base64,AAAA">
      <img id="c" src="asset://localhost/already">
    `);
    resolveMarkdownImages(el, '/Users/alice/notes/README.md');
    expect(convertFileSrc).not.toHaveBeenCalled();
    expect(el.querySelector('#a')!.getAttribute('src')).toBe('https://example.com/x.png');
    expect(el.querySelector('#b')!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(el.querySelector('#c')!.getAttribute('src')).toBe('asset://localhost/already');
  });

  it('rewrites every image in the container independently', () => {
    const el = container('<img id="a" src="./a.png"><img id="b" src="./b.png">');
    resolveMarkdownImages(el, '/Users/alice/notes/README.md');
    expect(convertFileSrc).toHaveBeenCalledTimes(2);
    expect(convertFileSrc).toHaveBeenCalledWith('/Users/alice/notes/a.png');
    expect(convertFileSrc).toHaveBeenCalledWith('/Users/alice/notes/b.png');
  });

  it('preserves ?v=<mtime> query on the final asset URL', () => {
    const el = container('<img src="./img/shot.png?v=1234567890">');
    resolveMarkdownImages(el, '/Users/alice/notes/README.md');
    expect(convertFileSrc).toHaveBeenCalledWith('/Users/alice/notes/img/shot.png');
    expect(el.querySelector('img')!.getAttribute('src')).toBe(
      'asset://localhost/%2FUsers%2Falice%2Fnotes%2Fimg%2Fshot.png?v=1234567890',
    );
  });
});
