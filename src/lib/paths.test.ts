import { describe, expect, it } from 'vitest';
import { formatHome, stemName, parentFolder } from './paths';

describe('formatHome', () => {
  it('replaces a /Users/<name> prefix with ~', () => {
    expect(formatHome('/Users/alice/notes/README.md')).toBe('~/notes/README.md');
  });

  it('leaves paths outside /Users untouched', () => {
    expect(formatHome('/tmp/scratch.md')).toBe('/tmp/scratch.md');
  });
});

describe('stemName', () => {
  it('strips the extension and directory', () => {
    expect(stemName('/Users/alice/notes/README.md')).toBe('README');
  });

  it('handles files with no extension', () => {
    expect(stemName('/Users/alice/notes/LICENSE')).toBe('LICENSE');
  });

  it('handles dotfiles without treating the leading dot as an extension separator', () => {
    expect(stemName('/Users/alice/.gitignore')).toBe('.gitignore');
  });

  it('handles multiple dots, keeping everything before the last one', () => {
    expect(stemName('/Users/alice/archive.tar.gz')).toBe('archive.tar');
  });
});

describe('parentFolder', () => {
  it('returns the immediate parent directory name', () => {
    expect(parentFolder('/a/PeekMD/README.md')).toBe('PeekMD');
  });

  it('returns the immediate parent even for deeply nested paths', () => {
    expect(parentFolder('/projects/PeekMD/docs/x.md')).toBe('docs');
  });

  it('returns empty string for a bare filename with no parent', () => {
    expect(parentFolder('README.md')).toBe('');
  });

  it('handles trailing slash gracefully', () => {
    expect(parentFolder('/a/b/')).toBe('a');
  });

  it('handles a relative two-segment path', () => {
    expect(parentFolder('a/b.md')).toBe('a');
  });
});
