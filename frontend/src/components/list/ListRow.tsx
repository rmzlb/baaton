import {
  Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, OctagonAlert, Clock, CheckCircle2, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/utils';
import { useClerkMembers } from '@/hooks/useClerkMembers';
import { CopyableId } from '@/components/shared/CopyableId';
import type { Issue, IssuePriority, IssueType, ProjectStatus, ProjectTag } from '@/lib/types';

const typeConfig: Record<IssueType, { icon: typeof Bug; color: string; bg: string; label: string }> = {
  bug:         { icon: Bug,        color: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-500/10',     label: 'Bug' },
  feature:     { icon: Sparkles,   color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-500/10', label: 'Feature' },
  improvement: { icon: Zap,        color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-50 dark:bg-blue-500/10',   label: 'Improvement' },
  question:    { icon: HelpCircle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', label: 'Question' },
};

const priorityConfig: Record<IssuePriority, { icon: typeof ArrowUp; color: string; label: string }> = {
  urgent: { icon: OctagonAlert,     color: 'text-red-500',    label: 'Urgent' },
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
  onContextMenu?: (e: React.MouseEvent, issue: Issue) => void;
  selected?: boolean;
  onSelect?: (id: string, shiftKey: boolean) => void;
}

function isNew(created_at: string, updated_at?: string): boolean {
  const age = Date.now() - new Date(created_at).getTime();
  if (age > 24 * 60 * 60 * 1000) return false; // older than 24h
  // If updated_at is very close to created_at, it's genuinely new (not an old import)
  if (updated_at) {
    const gap = Math.abs(new Date(updated_at).getTime() - new Date(created_at).getTime());
    if (gap > 60 * 60 * 1000) return false; // updated >1h after creation = likely import
  }
  return true;
}

export function ListRow({ issue, statuses, projectTags = [], onClick, onContextMenu, selected = false, onSelect }: ListRowProps) {
  const tc = typeConfig[issue.type] ?? typeConfig.feature;
  const TypeIcon = tc.icon;
  const status = statuses.find((s) => s.key === issue.status);
  const priority = issue.priority ? priorityConfig[issue.priority] : null;
  const PriorityIcon = priority?.icon;
  const isDone = issue.status === 'done' || issue.status === 'cancelled';
  const { resolveUserName, resolveUserAvatar } = useClerkMembers();

  const getTagColor = (tagName: string): string => {
    const found = projectTags.find((t) => t.name === tagName);
    return found?.color || '#6b7280';
  };

  const categories = issue.category || [];
  const creatorName = resolveUserName(issue.created_by_id, issue.created_by_name);

  return (
    <>
      {/* Desktop: table row — single line, compact */}
      <div
        onClick={onClick}
        onContextMenu={onContextMenu ? (e: React.MouseEvent) => onContextMenu(e, issue) : undefined}
        className={cn(
          'hidden md:grid grid-cols-[28px_72px_1fr_110px_90px_80px_80px_100px_90px] gap-1.5 border-b border-gray-100 dark:border-border/50 px-4 md:px-6 py-2 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-surface transition-colors items-center h-[38px] group/row',
          isDone && 'opacity-60 hover:opacity-90',
          selected && 'bg-accent/5 dark:bg-accent/10 hover:bg-accent/10',
        )}
      >
        {/* Checkbox */}
        <span
          onClick={(e) => { e.stopPropagation(); onSelect?.(issue.id, e.shiftKey); }}
          className={cn(
            'flex items-center justify-center w-4 h-4 rounded border cursor-pointer transition-colors',
            selected
              ? 'bg-accent border-accent text-black'
              : 'border-gray-300 dark:border-border opacity-0 group-hover/row:opacity-100',
          )}
        >
          {selected && <span className="text-[9px] font-bold">✓</span>}
        </span>

        {/* ID — compact, no subtitle */}
        <span className="flex items-center gap-1">
          <CopyableId id={issue.display_id} className="text-gray-400 dark:text-secondary text-[11px] truncate" iconSize={9} />
          {isNew(issue.created_at, issue.updated_at) && <span className="text-[8px] font-bold text-emerald-500 uppercase shrink-0">NEW</span>}
        </span>

        {/* Title — truncated, takes remaining space */}
        <span className={cn('font-medium truncate text-[12px] leading-tight', isDone ? 'line-through text-gray-400 dark:text-muted' : 'text-gray-900 dark:text-primary')}>
          {issue.title}
        </span>

        {/* Status */}
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: status?.color }} />
          <span className="text-secondary truncate text-[11px]">{status?.label || issue.status}</span>
        </span>

        {/* Priority */}
        <span className="flex items-center gap-1">
          {isDone ? (
            <CheckCircle2 size={11} className="text-emerald-500" />
          ) : PriorityIcon ? (
            <PriorityIcon size={11} className={priority?.color} />
          ) : null}
          <span className="text-gray-500 dark:text-secondary text-[11px]">{isDone ? 'Done' : priority?.label || '—'}</span>
        </span>

        {/* Type */}
        <span className={cn('inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium w-fit', tc.bg, tc.color)}>
          <TypeIcon size={10} />
          {tc.label}
        </span>

        {/* Tags */}
        <span className="flex items-center gap-0.5 overflow-hidden">
          {issue.tags.length > 0 ? issue.tags.slice(0, 1).map((tag) => {
            const color = getTagColor(tag);
            return (
              <span
                key={tag}
                className="rounded-full px-1.5 py-0 text-[9px] font-medium border truncate max-w-[70px]"
                style={{ backgroundColor: `${color}20`, borderColor: `${color}40`, color }}
              >
                {tag}
              </span>
            );
          }) : <span className="text-muted text-[10px]">—</span>}
          {issue.tags.length > 1 && <span className="text-[9px] text-muted">+{issue.tags.length - 1}</span>}
        </span>

        {/* Created by */}
        <span className="flex items-center gap-1 overflow-hidden">
          {(issue.created_by_id || issue.created_by_name) ? (() => {
            const avatar = resolveUserAvatar(issue.created_by_id);
            return (
              <>
                <img
                  src={avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(creatorName)}&backgroundColor=f0f0f0&textColor=666666`}
                  className="w-4 h-4 rounded-full shrink-0"
                  alt={creatorName}
                />
                <span className="text-[10px] text-secondary truncate">{creatorName.split(' ')[0]}</span>
              </>
            );
          })() : <span className="text-muted text-[10px]">—</span>}
        </span>

        {/* Assignees */}
        <span className="flex items-center gap-1">
          {issue.assignee_ids.length > 0 ? (
            <div className="flex -space-x-1">
              {issue.assignee_ids.slice(0, 2).map((id) => {
                const name = resolveUserName(id);
                const avatar = resolveUserAvatar(id);
                return (
                  <img
                    key={id}
                    src={avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=f0f0f0&textColor=666666`}
                    className="w-4 h-4 rounded-full ring-1 ring-white dark:ring-surface"
                    alt={name}
                    title={name}
                  />
                );
              })}
            </div>
          ) : <span className="text-gray-400 dark:text-muted text-[10px]">—</span>}
        </span>
      </div>

      {/* Mobile: card layout */}
      <div
        onClick={onClick}
        onContextMenu={onContextMenu ? (e: React.MouseEvent) => onContextMenu(e, issue) : undefined}
        className="md:hidden flex flex-col gap-1.5 border-b border-border/50 px-3 py-2.5 cursor-pointer hover:bg-surface transition-colors active:bg-surface-hover"
      >
        {/* Top row: ID + status + priority */}
        <div className="flex items-center gap-2">
          <CopyableId id={issue.display_id} className="text-secondary text-[11px]" iconSize={9} />
          {isNew(issue.created_at, issue.updated_at) && <span className="text-[8px] font-bold text-emerald-500 uppercase">NEW</span>}
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: status?.color }} />
            <span className="text-[10px] text-secondary">{status?.label || issue.status}</span>
          </span>
          {(issue.created_by_id || issue.created_by_name) && (
            <span className="text-[10px] text-muted flex items-center gap-0.5">
              <User size={9} />
              {creatorName.split(' ')[0]}
            </span>
          )}
          {PriorityIcon && (
            <PriorityIcon size={12} style={{ color: priority?.color }} className="ml-auto shrink-0" />
          )}
          <TypeIcon size={12} className={cn(typeConfig[issue.type]?.color, 'shrink-0')} />
        </div>

        {/* Title — max 2 lines */}
        <span className="text-[13px] text-primary font-medium leading-snug line-clamp-2">{issue.title}</span>

        {/* Bottom row: tags + assignees */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {categories.slice(0, 2).map((cat) => {
            const color = CATEGORY_COLORS[cat.toUpperCase()] || '#6b7280';
            return (
              <span key={cat} className="rounded px-1.5 py-0 text-[9px] font-bold uppercase" style={{ backgroundColor: `${color}20`, color }}>
                {cat}
              </span>
            );
          })}
          {issue.tags.slice(0, 2).map((tag) => {
            const color = getTagColor(tag);
            return (
              <span key={tag} className="rounded-full px-1.5 py-0 text-[9px] font-medium border" style={{ backgroundColor: `${color}20`, borderColor: `${color}40`, color }}>
                {tag}
              </span>
            );
          })}
          {issue.assignee_ids.length > 0 && (
            <div className="ml-auto flex -space-x-1">
              {issue.assignee_ids.slice(0, 2).map((id) => {
                const name = resolveUserName(id);
                const avatar = resolveUserAvatar(id);
                return (
                  <img
                    key={id}
                    src={avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=f0f0f0&textColor=666666`}
                    className="h-5 w-5 rounded-full ring-1 ring-white dark:ring-surface"
                    alt={name}
                    title={name}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
