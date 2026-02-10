import { useEffect, useRef, useState } from 'react';
import {
  Trash2, ArrowRight, Copy, ExternalLink,
  Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, Flame, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { Issue, IssueStatus, IssuePriority, ProjectStatus } from '@/lib/types';

/* ── Status colors ── */
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

/* ── Props ── */
interface KanbanContextMenuProps {
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

export function KanbanContextMenu({
  issue,
  position,
  statuses,
  onClose,
  onStatusChange,
  onPriorityChange,
  onDelete,
  onCopyId,
  onOpen,
}: KanbanContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [subMenu, setSubMenu] = useState<'status' | 'priority' | null>(null);

  // Close on click outside or Escape
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

  // Adjust position so menu doesn't overflow viewport
  const adjustedPosition = { ...position };
  if (typeof window !== 'undefined') {
    const menuWidth = 200;
    const menuHeight = 300;
    if (position.x + menuWidth > window.innerWidth) adjustedPosition.x = window.innerWidth - menuWidth - 8;
    if (position.y + menuHeight > window.innerHeight) adjustedPosition.y = window.innerHeight - menuHeight - 8;
    if (adjustedPosition.x < 8) adjustedPosition.x = 8;
    if (adjustedPosition.y < 8) adjustedPosition.y = 8;
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] rounded-lg border border-border bg-surface shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {/* Header: issue ID */}
      <div className="px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-mono text-muted">{issue.display_id}</span>
        <span className="text-[10px] text-muted ml-1.5 truncate">· {issue.title.slice(0, 30)}{issue.title.length > 30 ? '...' : ''}</span>
      </div>

      {/* Open */}
      <button
        onClick={() => { onOpen(issue); onClose(); }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-primary hover:bg-surface-hover transition-colors"
      >
        <ExternalLink size={12} className="text-secondary" />
        {t('contextMenu.open') || 'Open issue'}
      </button>

      {/* Copy ID */}
      <button
        onClick={() => { onCopyId(issue.display_id); onClose(); }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-primary hover:bg-surface-hover transition-colors"
      >
        <Copy size={12} className="text-secondary" />
        {t('contextMenu.copyId') || `Copy ${issue.display_id}`}
      </button>

      <div className="border-t border-border my-0.5" />

      {/* Move to status → submenu */}
      <div
        className="relative"
        onMouseEnter={() => setSubMenu('status')}
        onMouseLeave={() => setSubMenu(null)}
      >
        <button className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs text-primary hover:bg-surface-hover transition-colors">
          <span className="flex items-center gap-2">
            <ArrowRight size={12} className="text-secondary" />
            {t('contextMenu.moveTo') || 'Move to'}
          </span>
          <span className="text-muted text-[10px]">▸</span>
        </button>
        {subMenu === 'status' && (
          <div className="absolute left-full top-0 ml-0.5 min-w-[160px] rounded-lg border border-border bg-surface shadow-xl py-1 animate-in fade-in slide-in-from-left-1 duration-100">
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
                {issue.status === s.key && <span className="ml-auto text-[9px] text-muted">current</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Priority → submenu */}
      <div
        className="relative"
        onMouseEnter={() => setSubMenu('priority')}
        onMouseLeave={() => setSubMenu(null)}
      >
        <button className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs text-primary hover:bg-surface-hover transition-colors">
          <span className="flex items-center gap-2">
            <Flame size={12} className="text-secondary" />
            {t('contextMenu.priority') || 'Priority'}
          </span>
          <span className="text-muted text-[10px]">▸</span>
        </button>
        {subMenu === 'priority' && (
          <div className="absolute left-full top-0 ml-0.5 min-w-[140px] rounded-lg border border-border bg-surface shadow-xl py-1 animate-in fade-in slide-in-from-left-1 duration-100">
            {PRIORITY_OPTIONS.map((p) => {
              const isSelected = (issue.priority || '') === p.key;
              return (
                <button
                  key={p.key || 'none'}
                  onClick={() => { onPriorityChange(issue.id, p.key ? p.key as IssuePriority : null); onClose(); }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                    isSelected ? 'text-muted bg-surface-hover/50' : 'text-primary hover:bg-surface-hover',
                  )}
                >
                  <p.icon size={12} className={p.color} />
                  {p.label}
                  {isSelected && <span className="ml-auto text-[9px] text-muted">✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border my-0.5" />

      {/* Delete */}
      <button
        onClick={() => { onDelete(issue); onClose(); }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-500/10 transition-colors"
      >
        <Trash2 size={12} />
        {t('contextMenu.delete') || 'Delete issue'}
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
              {issue.title.slice(0, 50)}{issue.title.length > 50 ? '...' : ''}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted mb-4">
          {t('contextMenu.deleteWarning') || 'This action cannot be undone. All comments, TLDRs, and activity will be permanently deleted.'}
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
