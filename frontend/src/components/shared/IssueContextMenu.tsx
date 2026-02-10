import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Trash2, Copy, ExternalLink,
  ArrowUp, ArrowDown, Minus, Flame,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { useClerkMembers } from '@/hooks/useClerkMembers';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { useNotificationStore } from '@/stores/notifications';
import type { Issue, IssueStatus, IssuePriority, ProjectStatus } from '@/lib/types';

/* ── Status colors fallback ── */
const STATUS_COLORS: Record<string, string> = {
  backlog: '#6b7280',
  todo: '#3b82f6',
  in_progress: '#f59e0b',
  in_review: '#8b5cf6',
  done: '#22c55e',
  cancelled: '#ef4444',
};

/* ── Priority config ── */
const PRIORITY_OPTIONS: { key: IssuePriority | ''; label: string; icon: typeof ArrowUp; color: string }[] = [
  { key: 'urgent', label: 'Urgent', icon: Flame, color: 'text-red-500' },
  { key: 'high', label: 'High', icon: ArrowUp, color: 'text-orange-500' },
  { key: 'medium', label: 'Medium', icon: Minus, color: 'text-yellow-500' },
  { key: 'low', label: 'Low', icon: ArrowDown, color: 'text-gray-400' },
  { key: '', label: 'None', icon: Minus, color: 'text-gray-300' },
];

/* ── Hook: context menu state + actions (shared between kanban & list) ── */
export function useIssueContextMenu(statuses: ProjectStatus[], onIssueClick?: (issue: Issue) => void) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const updateIssueOptimistic = useIssuesStore((s) => s.updateIssueOptimistic);
  const removeIssue = useIssuesStore((s) => s.removeIssue);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const [contextMenu, setContextMenu] = useState<{ issue: Issue; x: number; y: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Issue | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, issue: Issue) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ issue, x: e.clientX, y: e.clientY });
  }, []);

  const handleStatusChange = useCallback(async (issueId: string, status: IssueStatus) => {
    // Optimistic
    updateIssueOptimistic(issueId, { status });
    try {
      await apiClient.issues.update(issueId, { status });
      addNotification({ type: 'success', title: t('contextMenu.statusChanged') || 'Status updated' });
    } catch {
      addNotification({ type: 'warning', title: t('optimistic.updateError') || 'Failed to update' });
    }
  }, [apiClient, updateIssueOptimistic, addNotification, t]);

  const handlePriorityChange = useCallback(async (issueId: string, priority: IssuePriority | null) => {
    updateIssueOptimistic(issueId, { priority: priority as any });
    try {
      await apiClient.issues.update(issueId, { priority });
      addNotification({ type: 'success', title: t('contextMenu.priorityChanged') || 'Priority updated' });
    } catch {
      addNotification({ type: 'warning', title: t('optimistic.updateError') || 'Failed to update' });
    }
  }, [apiClient, updateIssueOptimistic, addNotification, t]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    const { id, display_id } = deleteTarget;
    setDeleteTarget(null);
    removeIssue(id);
    try {
      await apiClient.issues.delete(id);
      addNotification({ type: 'success', title: `${display_id} deleted` });
    } catch {
      addNotification({ type: 'warning', title: t('contextMenu.deleteError') || 'Failed to delete' });
    }
  }, [deleteTarget, apiClient, removeIssue, addNotification, t]);

  const handleCopyId = useCallback((displayId: string) => {
    navigator.clipboard.writeText(displayId);
    addNotification({ type: 'success', title: `Copied ${displayId}` });
  }, [addNotification]);

  const handleOpen = useCallback((issue: Issue) => {
    onIssueClick?.(issue);
  }, [onIssueClick]);

  return {
    contextMenu,
    setContextMenu,
    deleteTarget,
    setDeleteTarget,
    handleContextMenu,
    handleStatusChange,
    handlePriorityChange,
    handleDeleteConfirm,
    handleCopyId,
    handleOpen,
  };
}

/* ── Context Menu Component — flat statuses, no submenu ── */

interface IssueContextMenuProps {
  issue: Issue;
  position: { x: number; y: number };
  statuses: ProjectStatus[];
  onClose: () => void;
  onStatusChange: (issueId: string, status: IssueStatus) => void;
  onPriorityChange: (issueId: string, priority: IssuePriority | null) => void;
  onDelete: (issue: Issue) => void;
  onCopyId: (displayId: string) => void;
  onOpen: (issue: Issue) => void;
}

export function IssueContextMenu({
  issue,
  position,
  statuses,
  onClose,
  onStatusChange,
  onPriorityChange,
  onDelete,
  onCopyId,
  onOpen,
}: IssueContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [showPriority, setShowPriority] = useState(false);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Adjust position to stay in viewport
  const adjusted = { ...position };
  if (typeof window !== 'undefined') {
    const w = 200, h = 400;
    if (position.x + w > window.innerWidth) adjusted.x = window.innerWidth - w - 8;
    if (position.y + h > window.innerHeight) adjusted.y = window.innerHeight - h - 8;
    if (adjusted.x < 8) adjusted.x = 8;
    if (adjusted.y < 8) adjusted.y = 8;
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] rounded-lg border border-border bg-surface shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjusted.x, top: adjusted.y }}
    >
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-mono text-accent">{issue.display_id}</span>
        <span className="text-[10px] text-muted ml-1 truncate">· {issue.title.slice(0, 28)}{issue.title.length > 28 ? '…' : ''}</span>
      </div>

      {/* Open + Copy */}
      <button
        onClick={() => { onOpen(issue); onClose(); }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-primary hover:bg-surface-hover transition-colors"
      >
        <ExternalLink size={12} className="text-secondary" />
        {t('contextMenu.open') || 'Open'}
      </button>
      <button
        onClick={() => { onCopyId(issue.display_id); onClose(); }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-primary hover:bg-surface-hover transition-colors"
      >
        <Copy size={12} className="text-secondary" />
        {t('contextMenu.copyId') || 'Copy ID'}
      </button>

      <div className="border-t border-border my-0.5" />

      {/* ── Statuses — flat, directly clickable ── */}
      <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-muted font-medium">
        {t('contextMenu.moveTo') || 'Move to'}
      </div>
      {statuses.map((s) => (
        <button
          key={s.key}
          disabled={issue.status === s.key}
          onClick={() => { onStatusChange(issue.id, s.key as IssueStatus); onClose(); }}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors',
            issue.status === s.key
              ? 'text-muted cursor-default bg-surface-hover/50'
              : 'text-primary hover:bg-surface-hover',
          )}
        >
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: s.color || STATUS_COLORS[s.key] || '#6b7280' }}
          />
          {s.label}
          {issue.status === s.key && <span className="ml-auto text-[9px] text-muted">✓</span>}
        </button>
      ))}

      <div className="border-t border-border my-0.5" />

      {/* ── Priority — expandable sub-section ── */}
      <button
        onClick={() => setShowPriority(!showPriority)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs text-primary hover:bg-surface-hover transition-colors"
      >
        <span className="flex items-center gap-2">
          <Flame size={12} className="text-secondary" />
          {t('contextMenu.priority') || 'Priority'}
        </span>
        <span className="text-muted text-[10px]">{showPriority ? '▾' : '▸'}</span>
      </button>
      {showPriority && PRIORITY_OPTIONS.map((p) => {
        const isSelected = (issue.priority || '') === p.key;
        return (
          <button
            key={p.key || 'none'}
            onClick={() => { onPriorityChange(issue.id, p.key ? p.key as IssuePriority : null); onClose(); }}
            className={cn(
              'flex w-full items-center gap-2 px-5 py-1.5 text-xs transition-colors',
              isSelected ? 'text-muted bg-surface-hover/50' : 'text-primary hover:bg-surface-hover',
            )}
          >
            <p.icon size={11} className={p.color} />
            {p.label}
            {isSelected && <span className="ml-auto text-[9px] text-muted">✓</span>}
          </button>
        );
      })}

      <div className="border-t border-border my-0.5" />

      {/* Delete */}
      <button
        onClick={() => { onDelete(issue); onClose(); }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10 transition-colors"
      >
        <Trash2 size={12} />
        {t('contextMenu.delete') || 'Delete'}
      </button>
    </div>
  );
}

/* ── Delete Confirmation Modal ── */

interface DeleteConfirmModalProps {
  issue: Issue;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmModal({ issue, onConfirm, onCancel }: DeleteConfirmModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 dark:bg-black/60" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-xl bg-surface border border-border shadow-2xl p-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
            <Trash2 size={20} className="text-red-500" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-primary">
              {t('contextMenu.deleteTitle') || 'Delete issue?'}
            </h3>
            <p className="text-xs text-muted mt-0.5">
              <span className="font-mono text-secondary">{issue.display_id}</span>
              {' · '}
              {issue.title.slice(0, 50)}{issue.title.length > 50 ? '…' : ''}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted mb-4">
          {t('contextMenu.deleteWarning') || 'This action cannot be undone.'}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-secondary hover:bg-surface-hover transition-colors"
          >
            {t('common.cancel') || 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-500 px-3 py-2 text-xs font-medium text-white hover:bg-red-600 transition-colors"
          >
            {t('contextMenu.confirmDelete') || 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
