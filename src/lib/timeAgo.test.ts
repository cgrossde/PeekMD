import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { timeAgo } from './timeAgo';

const NOW = new Date('2026-07-01T12:00:00.000Z');

function isoMinutesAgo(min: number) {
  return new Date(NOW.getTime() - min * 60_000).toISOString();
}

describe('timeAgo', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it('returns "just now" for anything under a minute', () => {
    expect(timeAgo(isoMinutesAgo(0.5))).toBe('just now');
  });

  it('returns minutes for under an hour', () => {
    expect(timeAgo(isoMinutesAgo(5))).toBe('5 min ago');
  });

  it('returns hours for under a day', () => {
    expect(timeAgo(isoMinutesAgo(3 * 60))).toBe('3h ago');
  });

  it('returns "yesterday" for 24-48h ago', () => {
    expect(timeAgo(isoMinutesAgo(30 * 60))).toBe('yesterday');
  });

  it('returns days for under a month', () => {
    expect(timeAgo(isoMinutesAgo(5 * 24 * 60))).toBe('5d ago');
  });

  it('returns a formatted date beyond a month', () => {
    expect(timeAgo(isoMinutesAgo(60 * 24 * 60))).toBe(
      new Date(NOW.getTime() - 60 * 24 * 60 * 60_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    );
  });
});
