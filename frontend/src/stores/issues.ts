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
}

export const useIssuesStore = create<IssuesState>()(
  immer((set) => ({
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
  })),
);
