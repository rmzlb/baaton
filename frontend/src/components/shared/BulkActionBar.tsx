import { useEffect, useCallback } from 'react';
import {
  CheckCircle2, XCircle, Trash2, X,
  ArrowRight, Flame, ArrowUp, ArrowDown, Minus,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { useNotificationStore } from '@/stores/notifications';
import type { Issue, IssueStatus, IssuePriority, ProjectStatus } from '@/lib/types';

interface BulkActionBarProps {
  selectedIds: Set<string>;
  issues: Issue[];
  statuses: ProjectStatus[];
  onClear: () => void;
  onDeselectAll: () => void;
  onSelectAll: () => void;
  totalCount: number;
}

export function BulkActionBar({
  selectedIds,
  issues,
  statuses,
  onClear,
  onDeselectAll,
  onSelectAll,
  totalCount,
}: BulkActionBarProps) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const updateIssueOptimistic = useIssuesStore((s) => s.updateIssueOptimistic);
  const removeIssue = useIssuesStore((s) => s.removeIssue);
  const addNotification = useNotificationStore((s) => s.addNotification);

  // Optimistically update TanStack Query cache
  const updateQueryCache = useCallback((issueId: string, patch: Partial<Issue>) => {
    for (const key of ['all-issues', 'issues']) {
      queryClient.setQueriesData({ queryKey: [key] }, (old: Issue[] | undefined) => {
        if (!old) return old;
        return old.map((i) => i.id === issueId ? { ...i, ...patch, updated_at: new Date().toISOString() } : i);
      });
    }
  }, [queryClient]);

  const removeFromQueryCache = useCallback((issueId: string) => {
    for (const key of ['all-issues', 'issues']) {
      queryClient.setQueriesData({ queryKey: [key] }, (old: Issue[] | undefined) => {
        if (!old) return old;
        return old.filter((i) => i.id !== issueId);
      });
    }
  }, [queryClient]);

  const count = selectedIds.size;
  if (count === 0) return null;

  const bulkUpdateStatus = async (status: IssueStatus) => {
    const ids = Array.from(selectedIds);
    // Optimistic: store + query cache
    ids.forEach((id) => { updateIssueOptimistic(id, { status }); updateQueryCache(id, { status }); });
    onClear();
    // API calls in parallel
    const results = await Promise.allSettled(
      ids.map((id) => apiClient.issues.update(id, { status })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      addNotification({ type: 'warning', title: `${failed}/${ids.length} failed to update` });
    } else {
      const label = statuses.find((s) => s.key === status)?.label || status;
      addNotification({ type: 'success', title: `${ids.length} issues → ${label}` });
    }
  };

  const bulkUpdatePriority = async (priority: IssuePriority | null) => {
    const ids = Array.from(selectedIds);
    ids.forEach((id) => { updateIssueOptimistic(id, { priority: priority as any }); updateQueryCache(id, { priority: priority as any }); });
    onClear();
    const results = await Promise.allSettled(
      ids.map((id) => apiClient.issues.update(id, { priority })),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      addNotification({ type: 'warning', title: `${failed}/${ids.length} failed` });
    } else {
      addNotification({ type: 'success', title: `${ids.length} issues priority updated` });
    }
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${count} issue${count > 1 ? 's' : ''}? This cannot be undone.`)) return;
    const ids = Array.from(selectedIds);
    ids.forEach((id) => { removeIssue(id); removeFromQueryCache(id); });
    onClear();
    const results = await Promise.allSettled(
      ids.map((id) => apiClient.issues.delete(id)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      addNotification({ type: 'warning', title: `${failed}/${ids.length} failed to delete` });
    } else {
      addNotification({ type: 'success', title: `${ids.length} issues deleted` });
    }
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-1.5 rounded-xl border border-border bg-surface shadow-2xl px-3 py-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Count + select all */}
      <div className="flex items-center gap-2 pr-2 border-r border-border">
        <span className="text-xs font-semibold text-primary">{count} selected</span>
        {count < totalCount && (
          <button
            onClick={onSelectAll}
            className="text-[10px] text-accent hover:underline"
          >
            Select all ({totalCount})
          </button>
        )}
      </div>

      {/* Quick status actions */}
      <button
        onClick={() => bulkUpdateStatus('done')}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
        title="Mark Done (D)"
      >
        <CheckCircle2 size={14} />
        <span className="hidden sm:inline">Done</span>
      </button>

      <button
        onClick={() => bulkUpdateStatus('cancelled')}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-500/10 transition-colors"
        title="Cancel (X)"
      >
        <XCircle size={14} />
        <span className="hidden sm:inline">Cancel</span>
      </button>

      {/* Status dropdown */}
      <StatusDropdown statuses={statuses} onSelect={bulkUpdateStatus} />

      {/* Priority dropdown */}
      <PriorityDropdown onSelect={bulkUpdatePriority} />

      {/* Delete */}
      <div className="pl-1.5 border-l border-border">
        <button
          onClick={bulkDelete}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors"
          title="Delete (⌫)"
        >
          <Trash2 size={14} />
          <span className="hidden sm:inline">Delete</span>
        </button>
      </div>

      {/* Close */}
      <button
        onClick={onDeselectAll}
        className="ml-1 rounded-md p-1 text-muted hover:text-primary hover:bg-surface-hover transition-colors"
        title="Deselect all (Esc)"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ── Status Dropdown ── */
import { useState, useRef } from 'react';

function StatusDropdown({ statuses, onSelect }: { statuses: ProjectStatus[]; onSelect: (s: IssueStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-secondary hover:bg-surface-hover transition-colors"
        title="Move to..."
      >
        <ArrowRight size={13} />
        <span className="hidden sm:inline">Move</span>
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 min-w-[140px] rounded-lg border border-border bg-surface shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100">
          {statuses.map((s) => (
            <button
              key={s.key}
              onClick={() => { onSelect(s.key as IssueStatus); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-primary hover:bg-surface-hover transition-colors"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PriorityDropdown({ onSelect }: { onSelect: (p: IssuePriority | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const opts: { key: IssuePriority | ''; label: string; icon: typeof Flame; color: string }[] = [
    { key: 'urgent', label: 'Urgent', icon: Flame, color: 'text-red-500' },
    { key: 'high', label: 'High', icon: ArrowUp, color: 'text-orange-500' },
    { key: 'medium', label: 'Medium', icon: Minus, color: 'text-yellow-500' },
    { key: 'low', label: 'Low', icon: ArrowDown, color: 'text-gray-400' },
    { key: '', label: 'None', icon: Minus, color: 'text-gray-300' },
  ];

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-secondary hover:bg-surface-hover transition-colors"
        title="Set priority"
      >
        <Flame size={13} />
        <span className="hidden sm:inline">Priority</span>
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 min-w-[130px] rounded-lg border border-border bg-surface shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100">
          {opts.map((p) => (
            <button
              key={p.key || 'none'}
              onClick={() => { onSelect(p.key ? p.key as IssuePriority : null); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-primary hover:bg-surface-hover transition-colors"
            >
              <p.icon size={11} className={p.color} />
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Keyboard Shortcuts Hook ── */

export function useBulkKeyboardShortcuts(
  selectedIds: Set<string>,
  statuses: ProjectStatus[],
  onMarkDone: () => void,
  onMarkCancelled: () => void,
  onDelete: () => void,
  onDeselectAll: () => void,
) {
  useEffect(() => {
    if (selectedIds.size === 0) return;

    const handler = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

      switch (e.key.toLowerCase()) {
        case 'd':
          e.preventDefault();
          onMarkDone();
          break;
        case 'x':
          e.preventDefault();
          onMarkCancelled();
          break;
        case 'backspace':
        case 'delete':
          e.preventDefault();
          onDelete();
          break;
        case 'escape':
          e.preventDefault();
          onDeselectAll();
          break;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedIds, onMarkDone, onMarkCancelled, onDelete, onDeselectAll]);
}
