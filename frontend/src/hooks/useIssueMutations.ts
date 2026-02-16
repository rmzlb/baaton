/**
 * useIssueMutations — Centralized issue mutations with TanStack Query best practices.
 *
 * Pattern: useMutation + onMutate (optimistic) + onError (rollback) + onSettled (sync)
 *
 * Inspired by:
 * - TanStack Query docs: https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates
 * - Vibe Kanban: bulkUpdateIssues pattern + local-first state
 *
 * Why this approach:
 * 1. Optimistic updates in BOTH query cache AND Zustand store
 * 2. Automatic rollback on error via snapshot
 * 3. Always refetch on settled to stay in sync with server
 * 4. Bulk mutations run in parallel with Promise.allSettled
 * 5. Single source of truth for all issue mutations
 */

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { useNotificationStore } from '@/stores/notifications';
import type { Issue, IssueStatus, IssuePriority } from '@/lib/types';

// ── Query key helpers ──────────────────────────
export const issueKeys = {
  all: ['all-issues'] as const,
  lists: () => [...issueKeys.all] as const,
  byProject: (projectId: string) => ['issues', projectId] as const,
  detail: (id: string) => ['issue', id] as const,
};

// ── Types ──────────────────────────────────────
type BoardQueryData = { project: unknown; issues: Issue[]; tags: unknown[] } | undefined;
type Snapshot = { queryKey: readonly unknown[]; data: unknown };

interface UpdateVars {
  issueId: string;
  patch: Partial<Issue>;
}

function isDoneStatus(status: IssueStatus | undefined): boolean {
  return status === 'done' || status === 'cancelled';
}

interface BulkUpdateVars {
  ids: string[];
  patch: Partial<Issue>;
}

interface DeleteVars {
  issueId: string;
  displayId: string;
}

interface BulkDeleteVars {
  ids: string[];
}

// ── Hook ───────────────────────────────────────
export function useIssueMutations() {
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const updateIssueOptimistic = useIssuesStore((s) => s.updateIssueOptimistic);
  const removeIssue = useIssuesStore((s) => s.removeIssue);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const findIssueInCache = useCallback((issueId: string): Issue | undefined => {
    const all = queryClient.getQueryData<Issue[]>(['all-issues']);
    const foundAll = all?.find((i) => i.id === issueId);
    if (foundAll) return foundAll;

    const issueLists = queryClient.getQueriesData<Issue[]>({ queryKey: ['issues'] });
    for (const [, list] of issueLists) {
      const found = list?.find((i) => i.id === issueId);
      if (found) return found;
    }

    // Also search composite project-board caches
    const boards = queryClient.getQueriesData<BoardQueryData>({ queryKey: ['project-board'] });
    for (const [, board] of boards) {
      const found = board?.issues?.find((i) => i.id === issueId);
      if (found) return found;
    }

    return undefined;
  }, [queryClient]);

  const withAutomationPatch = useCallback((issueId: string, patch: Partial<Issue>): Partial<Issue> => {
    const previous = findIssueInCache(issueId);
    const statusPatch = patch.status as IssueStatus | undefined;

    if (!statusPatch || !previous) return patch;

    const movedToDone = !isDoneStatus(previous.status) && statusPatch === 'done';
    if (!movedToDone) return patch;

    const nextPatch: Partial<Issue> = {
      ...patch,
    };

    const dueDate = previous.due_date ? new Date(previous.due_date) : null;
    if (dueDate && dueDate.getTime() < Date.now()) {
      // Minimal SLA automation: clear overdue due-date marker once issue is completed
      nextPatch.due_date = null;
    }

    return nextPatch;
  }, [findIssueInCache]);

  // ── Helper: optimistically update all issue query caches ──
  const optimisticUpdate = useCallback(
    (issueId: string, patch: Partial<Issue>) => {
      const snapshots: Snapshot[] = [];
      const patchWithTs = { ...patch, updated_at: new Date().toISOString() };

      // Update flat issue-array caches
      for (const prefix of ['all-issues', 'issues', 'my-issues'] as const) {
        queryClient.getQueriesData<Issue[]>({ queryKey: [prefix] }).forEach(([key, data]) => {
          if (data) {
            snapshots.push({ queryKey: key, data: [...data] });
            queryClient.setQueryData<Issue[]>(key, (old) =>
              old?.map((i) => (i.id === issueId ? { ...i, ...patchWithTs } : i)),
            );
          }
        });
      }

      // Update composite project-board caches ({ project, issues, tags })
      queryClient.getQueriesData<BoardQueryData>({ queryKey: ['project-board'] }).forEach(([key, data]) => {
        if (data?.issues) {
          snapshots.push({ queryKey: key, data: { ...data, issues: [...data.issues] } });
          queryClient.setQueryData(key, {
            ...data,
            issues: data.issues.map((i) => (i.id === issueId ? { ...i, ...patchWithTs } : i)),
          });
        }
      });

      // Also update Zustand store (for ProjectBoard)
      updateIssueOptimistic(issueId, patch);

      return snapshots;
    },
    [queryClient, updateIssueOptimistic],
  );

  // ── Helper: rollback from snapshots ──
  const rollback = useCallback(
    (snapshots: Snapshot[]) => {
      snapshots.forEach(({ queryKey, data }) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    [queryClient],
  );

  // ── Helper: optimistically remove from all caches ──
  const optimisticRemove = useCallback(
    (issueId: string) => {
      const snapshots: Snapshot[] = [];

      // Remove from flat issue-array caches
      for (const prefix of ['all-issues', 'issues', 'my-issues'] as const) {
        queryClient.getQueriesData<Issue[]>({ queryKey: [prefix] }).forEach(([key, data]) => {
          if (data) {
            snapshots.push({ queryKey: key, data: [...data] });
            queryClient.setQueryData<Issue[]>(key, (old) => old?.filter((i) => i.id !== issueId));
          }
        });
      }

      // Remove from composite project-board caches ({ project, issues, tags })
      queryClient.getQueriesData<BoardQueryData>({ queryKey: ['project-board'] }).forEach(([key, data]) => {
        if (data?.issues) {
          snapshots.push({ queryKey: key, data: { ...data, issues: [...data.issues] } });
          queryClient.setQueryData(key, {
            ...data,
            issues: data.issues.filter((i) => i.id !== issueId),
          });
        }
      });

      removeIssue(issueId);
      return snapshots;
    },
    [queryClient, removeIssue],
  );

  // ═══════════════════════════════════════════════
  // Single issue update
  // ═══════════════════════════════════════════════
  const updateMutation = useMutation({
    mutationFn: async ({ issueId, patch }: UpdateVars) => {
      const automatedPatch = withAutomationPatch(issueId, patch);
      return apiClient.issues.update(issueId, automatedPatch);
    },
    onMutate: async ({ issueId, patch }) => {
      const automatedPatch = withAutomationPatch(issueId, patch);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['all-issues'] }),
        queryClient.cancelQueries({ queryKey: ['issues'] }),
        queryClient.cancelQueries({ queryKey: ['project-board'] }),
        queryClient.cancelQueries({ queryKey: ['my-issues'] }),
      ]);
      const snapshots = optimisticUpdate(issueId, automatedPatch);
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        rollback(context.snapshots);
      }
      addNotification({
        type: 'warning',
        title: 'Failed to update issue',
        message: 'Changes have been reverted.',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-issues'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['project-board'] });
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
    },
  });

  // ═══════════════════════════════════════════════
  // Single issue delete
  // ═══════════════════════════════════════════════
  const deleteMutation = useMutation({
    mutationFn: async ({ issueId }: DeleteVars) => {
      return apiClient.issues.delete(issueId);
    },
    onMutate: async ({ issueId }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['all-issues'] }),
        queryClient.cancelQueries({ queryKey: ['issues'] }),
        queryClient.cancelQueries({ queryKey: ['project-board'] }),
        queryClient.cancelQueries({ queryKey: ['my-issues'] }),
      ]);
      const snapshots = optimisticRemove(issueId);
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        rollback(context.snapshots);
      }
      addNotification({ type: 'warning', title: 'Failed to delete issue' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-issues'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['project-board'] });
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
    },
  });

  // ═══════════════════════════════════════════════
  // Bulk update (status, priority, etc.)
  // ═══════════════════════════════════════════════
  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, patch }: BulkUpdateVars) => {
      const results = await Promise.allSettled(
        ids.map((id) => apiClient.issues.update(id, withAutomationPatch(id, patch))),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) throw new Error(`${failed}/${ids.length} failed`);
      return results;
    },
    onMutate: async ({ ids, patch }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['all-issues'] }),
        queryClient.cancelQueries({ queryKey: ['issues'] }),
        queryClient.cancelQueries({ queryKey: ['project-board'] }),
        queryClient.cancelQueries({ queryKey: ['my-issues'] }),
      ]);

      const allSnapshots: Snapshot[] = [];
      ids.forEach((id) => {
        const snapshots = optimisticUpdate(id, withAutomationPatch(id, patch));
        allSnapshots.push(...snapshots);
      });

      return { snapshots: allSnapshots };
    },
    onError: (_err, vars, context) => {
      if (context?.snapshots) {
        rollback(context.snapshots);
      }
      addNotification({ type: 'warning', title: `Failed to update ${vars.ids.length} issues` });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-issues'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['project-board'] });
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
    },
  });

  // ═══════════════════════════════════════════════
  // Bulk delete
  // ═══════════════════════════════════════════════
  const bulkDeleteMutation = useMutation({
    mutationFn: async ({ ids }: BulkDeleteVars) => {
      const results = await Promise.allSettled(ids.map((id) => apiClient.issues.delete(id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) throw new Error(`${failed}/${ids.length} failed`);
      return results;
    },
    onMutate: async ({ ids }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['all-issues'] }),
        queryClient.cancelQueries({ queryKey: ['issues'] }),
        queryClient.cancelQueries({ queryKey: ['project-board'] }),
        queryClient.cancelQueries({ queryKey: ['my-issues'] }),
      ]);
      const allSnapshots: Snapshot[] = [];
      ids.forEach((id) => {
        const snapshots = optimisticRemove(id);
        allSnapshots.push(...snapshots);
      });
      return { snapshots: allSnapshots };
    },
    onError: (_err, vars, context) => {
      if (context?.snapshots) {
        rollback(context.snapshots);
      }
      addNotification({ type: 'warning', title: `Failed to delete ${vars.ids.length} issues` });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-issues'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      queryClient.invalidateQueries({ queryKey: ['project-board'] });
      queryClient.invalidateQueries({ queryKey: ['my-issues'] });
    },
  });

  // ═══════════════════════════════════════════════
  // Convenience methods (used by context menu & bulk bar)
  // ═══════════════════════════════════════════════
  const updateStatus = useCallback(
    (issueId: string, status: IssueStatus) => {
      updateMutation.mutate({ issueId, patch: { status } });
    },
    [updateMutation],
  );

  const updatePriority = useCallback(
    (issueId: string, priority: IssuePriority | null) => {
      updateMutation.mutate({ issueId, patch: { priority: priority as any } });
    },
    [updateMutation],
  );

  const deleteIssue = useCallback(
    (issueId: string, displayId: string) => {
      deleteMutation.mutate({ issueId, displayId });
    },
    [deleteMutation],
  );

  const bulkUpdateStatus = useCallback(
    (ids: string[], status: IssueStatus) => {
      bulkUpdateMutation.mutate({ ids, patch: { status } }, {
        onSuccess: () => addNotification({ type: 'success', title: `${ids.length} → ${status}` }),
      });
    },
    [bulkUpdateMutation, addNotification],
  );

  const bulkUpdatePriority = useCallback(
    (ids: string[], priority: IssuePriority | null) => {
      bulkUpdateMutation.mutate({ ids, patch: { priority: priority as any } }, {
        onSuccess: () => addNotification({ type: 'success', title: `${ids.length} priority updated` }),
      });
    },
    [bulkUpdateMutation, addNotification],
  );

  const bulkDelete = useCallback(
    (ids: string[]) => {
      bulkDeleteMutation.mutate({ ids }, {
        onSuccess: () => addNotification({ type: 'success', title: `${ids.length} deleted` }),
      });
    },
    [bulkDeleteMutation, addNotification],
  );

  return {
    // Single mutations
    updateStatus,
    updatePriority,
    deleteIssue,
    updateMutation,
    deleteMutation,

    // Bulk mutations
    bulkUpdateStatus,
    bulkUpdatePriority,
    bulkDelete,
    bulkUpdateMutation,
    bulkDeleteMutation,

    // Raw helpers (for custom usage)
    optimisticUpdate,
    optimisticRemove,
    rollback,
  };
}
