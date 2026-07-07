import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveTheme, flipTheme, applyTheme } from './theme';

function mockSystemPrefersDark(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('resolveTheme', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the explicit override untouched', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('falls back to system preference when override is null', () => {
    mockSystemPrefersDark(true);
    expect(resolveTheme(null)).toBe('dark');
    mockSystemPrefersDark(false);
    expect(resolveTheme(null)).toBe('light');
  });
});

describe('flipTheme', () => {
  afterEach(() => vi.restoreAllMocks());

  it('flips an explicit light override to dark and back', () => {
    expect(flipTheme('light')).toBe('dark');
    expect(flipTheme('dark')).toBe('light');
  });

  it('flips relative to the resolved system theme when override is null', () => {
    mockSystemPrefersDark(true); // resolves to 'dark'
    expect(flipTheme(null)).toBe('light');
    mockSystemPrefersDark(false); // resolves to 'light'
    expect(flipTheme(null)).toBe('dark');
  });
});

describe('applyTheme', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sets data-theme on <html> to the resolved value', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
