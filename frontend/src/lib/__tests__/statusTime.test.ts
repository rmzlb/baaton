import { describe, expect, it } from 'vitest';
import { formatDuration, timePerStatus } from '../statusTime';

const HOUR = 3_600_000;

describe('formatDuration', () => {
  it('reads like a card badge', () => {
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(16 * HOUR)).toBe('16h');
    expect(formatDuration(52 * HOUR)).toBe('2d 4h');
    expect(formatDuration(12 * 24 * HOUR)).toBe('12d');
  });
});

describe('timePerStatus', () => {
  const created = '2026-09-22T10:00:00Z';
  const move = (at: string, from: string, to: string) => ({
    action: 'status_changed', field: 'status', old_value: from, new_value: to, created_at: at,
  });

  it('splits the life of an issue at each status move, newest-first input included', () => {
    const spans = timePerStatus(
      [move('2026-09-22T16:00:00Z', 'in_progress', 'in_review'), move('2026-09-22T12:00:00Z', 'todo', 'in_progress')],
      created,
      'in_review',
      new Date('2026-09-23T08:00:00Z'),
    );
    expect(spans).toEqual([
      { status: 'todo', ms: 2 * HOUR },
      { status: 'in_progress', ms: 4 * HOUR },
      { status: 'in_review', ms: 16 * HOUR },
    ]);
  });

  it('adds up a status visited twice and ignores other activity', () => {
    const spans = timePerStatus(
      [
        move('2026-09-22T11:00:00Z', 'todo', 'in_review'),
        { action: 'tag_added', field: 'tags', old_value: null, new_value: 'x', created_at: '2026-09-22T11:30:00Z' },
        move('2026-09-22T12:00:00Z', 'in_review', 'todo'),
        move('2026-09-22T13:00:00Z', 'todo', 'in_review'),
      ],
      created,
      'in_review',
      new Date('2026-09-22T15:00:00Z'),
    );
    expect(spans).toEqual([
      { status: 'todo', ms: 2 * HOUR },
      { status: 'in_review', ms: 3 * HOUR },
    ]);
  });

  it('falls back to the current status when nothing moved', () => {
    expect(timePerStatus([], created, 'backlog', new Date('2026-09-22T13:00:00Z')))
      .toEqual([{ status: 'backlog', ms: 3 * HOUR }]);
  });
});
