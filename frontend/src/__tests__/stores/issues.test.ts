/**
 * Expanded tests for the issues Zustand store.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useIssuesStore } from '@/stores/issues';
import { createIssue, resetCounters } from '@/test/factories';

describe('useIssuesStore', () => {
  beforeEach(() => {
    resetCounters();
    useIssuesStore.setState({
      issues: {},
      selectedIssueId: null,
      isDetailOpen: false,
    });
  });

  // ── Initial state ──────────────────────────────

  it('starts with empty state', () => {
    const state = useIssuesStore.getState();
    expect(state.issues).toEqual({});
    expect(state.selectedIssueId).toBeNull();
    expect(state.isDetailOpen).toBe(false);
  });

  // ── setIssues ──────────────────────────────────

  describe('setIssues', () => {
    it('sets issues indexed by id', () => {
      const issues = [
        createIssue({ id: 'a', title: 'First' }),
        createIssue({ id: 'b', title: 'Second' }),
      ];
      useIssuesStore.getState().setIssues(issues);
      const state = useIssuesStore.getState();
      expect(Object.keys(state.issues)).toHaveLength(2);
      expect(state.issues['a'].title).toBe('First');
      expect(state.issues['b'].title).toBe('Second');
    });

    it('replaces existing issues', () => {
      useIssuesStore.getState().setIssues([createIssue({ id: 'x' })]);
      expect(Object.keys(useIssuesStore.getState().issues)).toHaveLength(1);

      useIssuesStore.getState().setIssues([createIssue({ id: 'y' }), createIssue({ id: 'z' })]);
      const state = useIssuesStore.getState();
      expect(Object.keys(state.issues)).toHaveLength(2);
      expect(state.issues['x']).toBeUndefined();
    });

    it('handles empty array', () => {
      useIssuesStore.getState().setIssues([createIssue({ id: 'a' })]);
      useIssuesStore.getState().setIssues([]);
      expect(Object.keys(useIssuesStore.getState().issues)).toHaveLength(0);
    });
  });

  // ── updateIssue ────────────────────────────────

  describe('updateIssue', () => {
    it('updates a specific field', () => {
      useIssuesStore.getState().setIssues([createIssue({ id: 'a', title: 'Old' })]);
      useIssuesStore.getState().updateIssue('a', { title: 'New' });
      expect(useIssuesStore.getState().issues['a'].title).toBe('New');
    });

    it('preserves other fields', () => {
      useIssuesStore.getState().setIssues([
        createIssue({ id: 'a', title: 'Title', status: 'todo', priority: 'high' }),
      ]);
      useIssuesStore.getState().updateIssue('a', { status: 'done' });
      const issue = useIssuesStore.getState().issues['a'];
      expect(issue.status).toBe('done');
      expect(issue.title).toBe('Title');
      expect(issue.priority).toBe('high');
    });

    it('does nothing for non-existent issue', () => {
      useIssuesStore.getState().setIssues([createIssue({ id: 'a' })]);
      useIssuesStore.getState().updateIssue('nonexistent', { title: 'Nope' });
      expect(useIssuesStore.getState().issues['a']).toBeDefined();
      expect(useIssuesStore.getState().issues['nonexistent']).toBeUndefined();
    });

    it('updates multiple fields at once', () => {
      useIssuesStore.getState().setIssues([createIssue({ id: 'a' })]);
      useIssuesStore.getState().updateIssue('a', {
        title: 'Updated',
        status: 'in_progress',
        priority: 'urgent',
        tags: ['critical'],
      });
      const issue = useIssuesStore.getState().issues['a'];
      expect(issue.title).toBe('Updated');
      expect(issue.status).toBe('in_progress');
      expect(issue.priority).toBe('urgent');
      expect(issue.tags).toEqual(['critical']);
    });
  });

  // ── moveIssue ──────────────────────────────────

  describe('moveIssue', () => {
    it('updates status and position', () => {
      useIssuesStore.getState().setIssues([
        createIssue({ id: 'a', status: 'todo', position: 1000 }),
      ]);
      useIssuesStore.getState().moveIssue('a', 'done', 5000);
      const issue = useIssuesStore.getState().issues['a'];
      expect(issue.status).toBe('done');
      expect(issue.position).toBe(5000);
    });

    it('does nothing for non-existent issue', () => {
      useIssuesStore.getState().setIssues([createIssue({ id: 'a', status: 'todo' })]);
      useIssuesStore.getState().moveIssue('nonexistent', 'done', 1000);
      expect(useIssuesStore.getState().issues['a'].status).toBe('todo');
    });
  });

  // ── selectIssue ────────────────────────────────

  describe('selectIssue', () => {
    it('sets selectedIssueId', () => {
      useIssuesStore.getState().selectIssue('issue-1');
      expect(useIssuesStore.getState().selectedIssueId).toBe('issue-1');
    });

    it('clears selection with null', () => {
      useIssuesStore.getState().selectIssue('issue-1');
      useIssuesStore.getState().selectIssue(null);
      expect(useIssuesStore.getState().selectedIssueId).toBeNull();
    });
  });

  // ── openDetail / closeDetail ───────────────────

  describe('openDetail / closeDetail', () => {
    it('opens detail with issue id', () => {
      useIssuesStore.getState().openDetail('issue-42');
      const state = useIssuesStore.getState();
      expect(state.isDetailOpen).toBe(true);
      expect(state.selectedIssueId).toBe('issue-42');
    });

    it('closes detail', () => {
      useIssuesStore.getState().openDetail('issue-42');
      useIssuesStore.getState().closeDetail();
      const state = useIssuesStore.getState();
      expect(state.isDetailOpen).toBe(false);
      // selectedIssueId is not cleared on close
      expect(state.selectedIssueId).toBe('issue-42');
    });

    it('can open different issues sequentially', () => {
      useIssuesStore.getState().openDetail('issue-1');
      expect(useIssuesStore.getState().selectedIssueId).toBe('issue-1');
      useIssuesStore.getState().openDetail('issue-2');
      expect(useIssuesStore.getState().selectedIssueId).toBe('issue-2');
      expect(useIssuesStore.getState().isDetailOpen).toBe(true);
    });

    it('close then reopen works', () => {
      useIssuesStore.getState().openDetail('issue-1');
      useIssuesStore.getState().closeDetail();
      expect(useIssuesStore.getState().isDetailOpen).toBe(false);

      useIssuesStore.getState().openDetail('issue-2');
      expect(useIssuesStore.getState().isDetailOpen).toBe(true);
      expect(useIssuesStore.getState().selectedIssueId).toBe('issue-2');
    });
  });
});
