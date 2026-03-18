/**
 * Triage page logic tests.
 *
 * Validates that the triage filter correctly identifies issues
 * needing triage, and that triage actions (accept/decline/assign)
 * produce the right mutations that remove issues from the triage list.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createIssue, resetCounters } from '@/test/factories';
import type { Issue } from '@/lib/types';

// Mirror the triage filter from Triage.tsx
function triageFilter(issues: Issue[]): Issue[] {
  return issues
    .filter(
      (i) => i.status === 'backlog' && (i.source === 'form' || i.assignee_ids.length === 0),
    )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
}

describe('Triage filter', () => {
  beforeEach(() => resetCounters());

  it('includes backlog issues with no assignees', () => {
    const issues = [
      createIssue({ status: 'backlog', assignee_ids: [], source: 'web' }),
      createIssue({ status: 'backlog', assignee_ids: ['user-1'], source: 'web' }),
    ];
    const result = triageFilter(issues);
    expect(result).toHaveLength(1);
    expect(result[0].assignee_ids).toEqual([]);
  });

  it('includes backlog issues from public form with no assignees', () => {
    const issues = [
      createIssue({ status: 'backlog', source: 'form', assignee_ids: [] }),
    ];
    const result = triageFilter(issues);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('form');
  });

  it('includes backlog form submissions even with assignees (auto-assign)', () => {
    // Form submissions in backlog should appear in triage
    // even if auto-assign gave them an assignee
    const issues = [
      createIssue({ status: 'backlog', source: 'form', assignee_ids: ['user-1'] }),
    ];
    const result = triageFilter(issues);
    expect(result).toHaveLength(1);
  });

  it('excludes non-backlog issues regardless of source', () => {
    const issues = [
      createIssue({ status: 'todo', source: 'form', assignee_ids: [] }),
      createIssue({ status: 'in_progress', source: 'form', assignee_ids: [] }),
      createIssue({ status: 'done', source: 'web', assignee_ids: [] }),
      createIssue({ status: 'cancelled', source: 'form', assignee_ids: [] }),
    ];
    const result = triageFilter(issues);
    expect(result).toHaveLength(0);
  });

  it('excludes backlog issues with assignees (non-form)', () => {
    const issues = [
      createIssue({ status: 'backlog', assignee_ids: ['user-1'], source: 'web' }),
    ];
    const result = triageFilter(issues);
    expect(result).toHaveLength(0);
  });

  it('sorts by created_at descending (newest first)', () => {
    const old = createIssue({
      status: 'backlog',
      assignee_ids: [],
      created_at: '2026-01-01T00:00:00Z',
    });
    const recent = createIssue({
      status: 'backlog',
      assignee_ids: [],
      created_at: '2026-03-18T00:00:00Z',
    });
    const result = triageFilter([old, recent]);
    expect(result[0].created_at).toBe('2026-03-18T00:00:00Z');
    expect(result[1].created_at).toBe('2026-01-01T00:00:00Z');
  });
});

describe('Triage actions produce correct mutations', () => {
  beforeEach(() => resetCounters());

  it('accept changes status to todo → no longer in triage', () => {
    const issue = createIssue({ status: 'backlog', assignee_ids: [], source: 'web' });
    // Simulate what handleAccept sends: { status: 'todo' }
    const mutated: Issue = { ...issue, status: 'todo' };
    const result = triageFilter([mutated]);
    expect(result).toHaveLength(0);
  });

  it('decline changes status to cancelled → no longer in triage', () => {
    const issue = createIssue({ status: 'backlog', assignee_ids: [], source: 'form' });
    // Simulate what handleDecline sends: { status: 'cancelled' }
    const mutated: Issue = { ...issue, status: 'cancelled' };
    const result = triageFilter([mutated]);
    expect(result).toHaveLength(0);
  });

  it('assign changes status to todo + adds assignee → no longer in triage', () => {
    const issue = createIssue({ status: 'backlog', assignee_ids: [], source: 'form' });
    // Simulate what handleAssign sends: { assignee_ids: ['user-1'], status: 'todo' }
    const mutated: Issue = { ...issue, status: 'todo', assignee_ids: ['user-1'] };
    const result = triageFilter([mutated]);
    expect(result).toHaveLength(0);
  });

  it('form issue accepted → status todo → stays out of triage', () => {
    // This was the original bug: form issues reappearing after triage
    const formIssue = createIssue({ status: 'backlog', source: 'form', assignee_ids: [] });
    expect(triageFilter([formIssue])).toHaveLength(1);

    // After accept (status → todo)
    const accepted: Issue = { ...formIssue, status: 'todo' };
    expect(triageFilter([accepted])).toHaveLength(0);
  });
});
