import { vi } from 'vitest';
import '@testing-library/jest-dom';

// jsdom doesn't implement matchMedia. Several modules (lib/theme.ts) call it
// to resolve the "follow system" theme preference; stub it to "light" by
// default so tests are deterministic unless a test overrides it.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
