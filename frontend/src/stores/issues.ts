import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Issue, IssueStatus } from '@/lib/types';

interface IssuesState {
  issues: Record<string, Issue>;
  selectedIssueId: string | null;
  isDetailOpen: boolean;

  // Actions
  setIssues: (issues: Issue[]) => void;
  updateIssue: (id: string, patch: Partial<Issue>) => void;
  moveIssue: (id: string, newStatus: IssueStatus, newPosition: number) => void;
  selectIssue: (id: string | null) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;

  removeIssue: (id: string) => void;

  // Optimistic operations
  moveIssueOptimistic: (issueId: string, newStatus: IssueStatus, newPosition: number) => Record<string, Issue>;
  updateIssueOptimistic: (id: string, patch: Partial<Issue>) => Record<string, Issue>;
  restoreIssues: (snapshot: Record<string, Issue>) => void;
}

export const useIssuesStore = create<IssuesState>()(
  immer((set, get) => ({
    issues: {},
    selectedIssueId: null,
    isDetailOpen: false,

    setIssues: (issues) =>
      set((state) => {
        state.issues = {};
        for (const issue of issues) {
          state.issues[issue.id] = issue;
        }
      }),

    updateIssue: (id, patch) =>
      set((state) => {
        if (state.issues[id]) {
          Object.assign(state.issues[id], patch);
        }
      }),

    removeIssue: (id) =>
      set((state) => {
        delete state.issues[id];
      }),

    moveIssue: (id, newStatus, newPosition) =>
      set((state) => {
        if (state.issues[id]) {
          state.issues[id].status = newStatus;
          state.issues[id].position = newPosition;
        }
      }),

    selectIssue: (id) =>
      set((state) => {
        state.selectedIssueId = id;
      }),

    openDetail: (id) =>
      set((state) => {
        state.selectedIssueId = id;
        state.isDetailOpen = true;
      }),

    closeDetail: () =>
      set((state) => {
        state.isDetailOpen = false;
      }),

    // ── Optimistic: move issue, return previous snapshot for rollback ──
    moveIssueOptimistic: (issueId, newStatus, newPosition) => {
      // Deep-copy current state for rollback (plain JS objects from immer)
      const previousIssues = JSON.parse(JSON.stringify(get().issues)) as Record<string, Issue>;

      set((state) => {
        const issue = state.issues[issueId];
        if (issue) {
          issue.status = newStatus;
          issue.position = newPosition;
        }
      });

      return previousIssues;
    },

    // ── Optimistic: update any issue fields, return previous snapshot ──
    updateIssueOptimistic: (id, patch) => {
      const previousIssues = JSON.parse(JSON.stringify(get().issues)) as Record<string, Issue>;

      set((state) => {
        if (state.issues[id]) {
          Object.assign(state.issues[id], patch);
        }
      });

      return previousIssues;
    },

    // ── Restore state from snapshot (rollback) ──
    restoreIssues: (snapshot) =>
      set((state) => {
        state.issues = snapshot;
      }),
  })),
);
