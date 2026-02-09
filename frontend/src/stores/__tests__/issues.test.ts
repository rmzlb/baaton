import { describe, it, expect, beforeEach } from 'vitest';
import { useIssuesStore } from '../issues';

describe('useIssuesStore', () => {
  beforeEach(() => {
    useIssuesStore.setState({
      issues: {},
      selectedIssueId: null,
      isDetailOpen: false,
    });
  });

  it('starts with empty state', () => {
    const state = useIssuesStore.getState();
    expect(state.issues).toEqual({});
    expect(state.selectedIssueId).toBeNull();
    expect(state.isDetailOpen).toBe(false);
  });

  it('sets issues by id', () => {
    const mockIssues = [
      { id: '1', title: 'Test', display_id: 'TST-1', status: 'todo', position: 1000 },
      { id: '2', title: 'Test 2', display_id: 'TST-2', status: 'in_progress', position: 2000 },
    ] as any[];

    useIssuesStore.getState().setIssues(mockIssues);
    const state = useIssuesStore.getState();
    expect(Object.keys(state.issues)).toHaveLength(2);
    expect(state.issues['1'].title).toBe('Test');
  });

  it('updates an issue', () => {
    useIssuesStore.getState().setIssues([
      { id: '1', title: 'Old', status: 'todo', position: 1000 },
    ] as any[]);

    useIssuesStore.getState().updateIssue('1', { title: 'New' });
    expect(useIssuesStore.getState().issues['1'].title).toBe('New');
  });

  it('moves an issue', () => {
    useIssuesStore.getState().setIssues([
      { id: '1', title: 'Test', status: 'todo', position: 1000 },
    ] as any[]);

    useIssuesStore.getState().moveIssue('1', 'done', 3000);
    const issue = useIssuesStore.getState().issues['1'];
    expect(issue.status).toBe('done');
    expect(issue.position).toBe(3000);
  });

  it('opens and closes detail', () => {
    useIssuesStore.getState().openDetail('1');
    expect(useIssuesStore.getState().isDetailOpen).toBe(true);
    expect(useIssuesStore.getState().selectedIssueId).toBe('1');

    useIssuesStore.getState().closeDetail();
    expect(useIssuesStore.getState().isDetailOpen).toBe(false);
  });
});
