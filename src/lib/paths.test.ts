import { describe, expect, it } from 'vitest';
import { formatHome, stemName, disambiguator } from './paths';

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

describe('disambiguator', () => {
  it('returns null when the stem is unique', () => {
    const paths = ['/a/PeekMD/README.md', '/b/jiracli/CHANGELOG.md'];
    expect(disambiguator(paths, '/a/PeekMD/README.md')).toBeNull();
  });

  it('returns the immediate parent when it disambiguates', () => {
    const paths = ['/a/PeekMD/README.md', '/b/jiracli/README.md'];
    expect(disambiguator(paths, '/a/PeekMD/README.md')).toBe('(PeekMD)');
    expect(disambiguator(paths, '/b/jiracli/README.md')).toBe('(jiracli)');
  });

  it('climbs to grandparent when the immediate parent is shared', () => {
    const paths = ['/projects/PeekMD/README.md', '/projects/jiracli/README.md'];
    // Immediate parents are different — PeekMD vs jiracli — so depth 1 suffices.
    expect(disambiguator(paths, '/projects/PeekMD/README.md')).toBe('(PeekMD)');
  });

  it('uses grandparent when parents are identical', () => {
    const paths = ['/work/src/README.md', '/personal/src/README.md'];
    expect(disambiguator(paths, '/work/src/README.md')).toBe('(work/src)');
    expect(disambiguator(paths, '/personal/src/README.md')).toBe('(personal/src)');
  });

  it('handles three or more duplicates', () => {
    const paths = ['/a/src/index.md', '/b/src/index.md', '/c/src/index.md'];
    expect(disambiguator(paths, '/a/src/index.md')).toBe('(a/src)');
  });

  it('disambiguates against both open and recent paths', () => {
    // Simulates one open doc and one recent doc sharing a stem.
    const paths = ['/projects/PeekMD/README.md', '/projects/jiracli/README.md'];
    expect(disambiguator(paths, '/projects/PeekMD/README.md')).toBe('(PeekMD)');
  });
});
