import { describe, it, expect } from 'vitest';
import { cn, timeAgo } from '../utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('handles undefined/null', () => {
    expect(cn('base', undefined, null, 'end')).toBe('base end');
  });

  it('merges tailwind conflicts', () => {
    const result = cn('px-2', 'px-4');
    expect(result).toBe('px-4');
  });
});

describe('timeAgo', () => {
  it('returns "just now" for recent times', () => {
    const now = new Date().toISOString();
    const result = timeAgo(now);
    expect(result).toMatch(/just now|0m|1m/);
  });

  it('handles hour-old timestamps', () => {
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    const result = timeAgo(hourAgo);
    expect(result).toMatch(/1h|60m/);
  });

  it('handles day-old timestamps', () => {
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    const result = timeAgo(dayAgo);
    expect(result).toMatch(/1d|24h/);
  });
});
