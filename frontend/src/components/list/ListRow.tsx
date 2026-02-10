import {
  Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, Flame, Clock, CheckCircle2, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/utils';
import type { Issue, IssuePriority, IssueType, ProjectStatus, ProjectTag } from '@/lib/types';

const typeConfig: Record<IssueType, { icon: typeof Bug; color: string; bg: string; label: string }> = {
  bug:         { icon: Bug,        color: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-500/10',     label: 'Bug' },
  feature:     { icon: Sparkles,   color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-500/10', label: 'Feature' },
  improvement: { icon: Zap,        color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-50 dark:bg-blue-500/10',   label: 'Improvement' },
  question:    { icon: HelpCircle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', label: 'Question' },
};

const priorityConfig: Record<IssuePriority, { icon: typeof ArrowUp; color: string; label: string }> = {
  urgent: { icon: Flame,     color: 'text-red-500',    label: 'Urgent' },
  high:   { icon: ArrowUp,   color: 'text-orange-500', label: 'High' },
  medium: { icon: Minus,     color: 'text-yellow-500', label: 'Medium' },
  low:    { icon: ArrowDown, color: 'text-gray-400',   label: 'Low' },
};

const CATEGORY_COLORS: Record<string, string> = {
  FRONT: '#3b82f6',
  BACK: '#22c55e',
  API: '#8b5cf6',
  DB: '#f97316',
};

interface ListRowProps {
  issue: Issue;
  statuses: ProjectStatus[];
  projectTags?: ProjectTag[];
  onClick: () => void;
}

export function ListRow({ issue, statuses, projectTags = [], onClick }: ListRowProps) {
  const tc = typeConfig[issue.type] ?? typeConfig.feature;
  const TypeIcon = tc.icon;
  const status = statuses.find((s) => s.key === issue.status);
  const priority = issue.priority ? priorityConfig[issue.priority] : null;
  const PriorityIcon = priority?.icon;
  const isDone = issue.status === 'done' || issue.status === 'cancelled';

  const getTagColor = (tagName: string): string => {
    const found = projectTags.find((t) => t.name === tagName);
    return found?.color || '#6b7280';
  };

  const categories = issue.category || [];

  return (
    <>
      {/* Desktop: table row */}
      <div
        onClick={onClick}
        className={cn(
          'hidden md:grid grid-cols-[80px_1fr_120px_100px_90px_90px_120px_80px_100px] gap-2 border-b border-gray-100 dark:border-border/50 px-4 md:px-6 py-2.5 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-surface transition-colors items-center min-h-[44px]',
          isDone && 'opacity-60 hover:opacity-90',
        )}
      >
        {/* ID */}
        <span className="font-mono text-gray-400 dark:text-secondary text-[11px] truncate">{issue.display_id}</span>

        {/* Title */}
        <span className={cn('font-medium truncate', isDone ? 'line-through text-gray-400 dark:text-muted' : 'text-gray-900 dark:text-primary')}>{issue.title}</span>

        {/* Status */}
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: status?.color }}
          />
          <span className="text-secondary truncate">{status?.label || issue.status}</span>
        </span>

        {/* Priority */}
        <span className="flex items-center gap-1.5">
          {isDone ? (
            <CheckCircle2 size={12} className="text-emerald-500" />
          ) : PriorityIcon ? (
            <PriorityIcon size={12} className={priority?.color} />
          ) : null}
          <span className="text-gray-500 dark:text-secondary">{isDone ? 'Done' : priority?.label || '—'}</span>
        </span>

        {/* Type */}
        <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium w-fit', tc.bg, tc.color)}>
          <TypeIcon size={11} />
          {tc.label}
        </span>

        {/* Category */}
        <span className="flex items-center gap-1 overflow-hidden">
          {categories.length > 0 ? (
            categories.slice(0, 2).map((cat) => {
              const color = CATEGORY_COLORS[cat.toUpperCase()] || '#6b7280';
              return (
                <span
                  key={cat}
                  className="rounded px-1.5 py-0 text-[9px] font-bold uppercase"
                  style={{
                    backgroundColor: `${color}20`,
                    color: color,
                  }}
                >
                  {cat}
                </span>
              );
            })
          ) : (
            <span className="text-muted">—</span>
          )}
        </span>

        {/* Tags */}
        <span className="flex items-center gap-1 overflow-hidden">
          {issue.tags.slice(0, 2).map((tag) => {
            const color = getTagColor(tag);
            return (
              <span
                key={tag}
                className="rounded-full px-1.5 py-0 text-[9px] font-medium border truncate"
                style={{
                  backgroundColor: `${color}20`,
                  borderColor: `${color}40`,
                  color: color,
                }}
              >
                {tag}
              </span>
            );
          })}
          {issue.tags.length > 2 && (
            <span className="text-[9px] text-muted">+{issue.tags.length - 2}</span>
          )}
        </span>

        {/* Assignees */}
        <span className="flex -space-x-1">
          {issue.assignee_ids.slice(0, 2).map((id) => (
            <img
              key={id}
              src={`https://api.dicebear.com/9.x/initials/svg?seed=${id}&backgroundColor=f0f0f0&textColor=666666`}
              className="w-5 h-5 rounded-full ring-1 ring-white dark:ring-surface"
              alt="Assignee"
            />
          ))}
          {issue.assignee_ids.length === 0 && <span className="text-gray-400 dark:text-muted">—</span>}
        </span>

        {/* Due Date */}
        <span className="text-[10px]">
          {issue.due_date ? (() => {
            const due = new Date(issue.due_date);
            const now = new Date();
            const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const isOverdue = diffDays < 0;
            const isSoon = diffDays >= 0 && diffDays <= 3;
            return (
              <span className={cn(
                'flex items-center gap-0.5',
                isOverdue ? 'text-red-400' : isSoon ? 'text-amber-400' : 'text-muted',
              )}>
                <Clock size={10} />
                {due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            );
          })() : <span className="text-muted">—</span>}
        </span>

        {/* Updated */}
        <span className="text-muted text-[10px]">{timeAgo(issue.updated_at)}</span>
      </div>

      {/* Mobile: card layout */}
      <div
        onClick={onClick}
        className="md:hidden flex flex-col gap-2 border-b border-border/50 px-3 py-3 cursor-pointer hover:bg-surface transition-colors active:bg-surface-hover min-h-[44px]"
      >
        {/* Top row: ID + status + priority */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-secondary text-[11px]">{issue.display_id}</span>
          <span className="flex items-center gap-1">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: status?.color }}
            />
            <span className="text-[10px] text-secondary">{status?.label || issue.status}</span>
          </span>
          {PriorityIcon && (
            <PriorityIcon size={12} style={{ color: priority?.color }} className="ml-auto shrink-0" />
          )}
          <TypeIcon size={12} className={cn(typeConfig[issue.type]?.color, 'shrink-0')} />
        </div>

        {/* Title */}
        <span className="text-sm text-primary font-medium leading-snug line-clamp-2">{issue.title}</span>

        {/* Bottom row: tags + assignees + updated */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {categories.slice(0, 2).map((cat) => {
            const color = CATEGORY_COLORS[cat.toUpperCase()] || '#6b7280';
            return (
              <span
                key={cat}
                className="rounded px-1.5 py-0 text-[9px] font-bold uppercase"
                style={{ backgroundColor: `${color}20`, color }}
              >
                {cat}
              </span>
            );
          })}
          {issue.tags.slice(0, 2).map((tag) => {
            const color = getTagColor(tag);
            return (
              <span
                key={tag}
                className="rounded-full px-1.5 py-0 text-[9px] font-medium border"
                style={{ backgroundColor: `${color}20`, borderColor: `${color}40`, color }}
              >
                {tag}
              </span>
            );
          })}
          {issue.assignee_ids.length > 0 && (
            <div className="ml-auto flex -space-x-1">
              {issue.assignee_ids.slice(0, 2).map((id) => (
                <div
                  key={id}
                  className="h-5 w-5 rounded-full bg-surface-hover border border-bg flex items-center justify-center text-[7px] font-mono text-secondary"
                >
                  {id.slice(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
          )}
          <span className="text-muted text-[10px] ml-auto">{timeAgo(issue.updated_at)}</span>
        </div>
      </div>
    </>
  );
}
