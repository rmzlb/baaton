import type { DraggableProvided } from '@hello-pangea/dnd';
import {
  Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, Flame, Bot,
  Clock, MoreHorizontal, CheckCircle2, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';
import { useClerkMembers } from '@/hooks/useClerkMembers';
import { GitHubPrBadge } from '@/components/github/GitHubPrBadge';
import type { Issue, IssuePriority, IssueType, ProjectTag, GitHubPrLink } from '@/lib/types';

/** Strip HTML tags and collapse whitespace for clean text preview */
function stripHtml(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol|blockquote|tr)[\s>]/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

interface KanbanCardProps {
  issue: Issue;
  provided: DraggableProvided;
  isDragging: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent, issue: Issue) => void;
  projectTags?: ProjectTag[];
  githubPrs?: GitHubPrLink[];
}

// ── Type config ──
const typeConfig: Record<IssueType, { icon: typeof Bug; color: string; bg: string; label: string }> = {
  bug:         { icon: Bug,        color: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-500/10',     label: 'Bug' },
  feature:     { icon: Sparkles,   color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-500/10', label: 'Feature' },
  improvement: { icon: Zap,        color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-50 dark:bg-blue-500/10',   label: 'Improvement' },
  question:    { icon: HelpCircle, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', label: 'Question' },
};

// ── Priority config ──
const priorityConfig: Record<IssuePriority, { icon: typeof ArrowUp; color: string; label: string }> = {
  urgent: { icon: Flame,     color: 'text-red-500',    label: 'Urgent' },
  high:   { icon: ArrowUp,   color: 'text-orange-500', label: 'High' },
  medium: { icon: Minus,     color: 'text-yellow-500', label: 'Medium' },
  low:    { icon: ArrowDown, color: 'text-gray-400',   label: 'Low' },
};

// ── Tag pastel styles ──
function getTagStyle(color: string) {
  const MAP: Record<string, { bg: string; text: string; border: string }> = {
    '#3b82f6': { bg: 'bg-blue-50 dark:bg-blue-500/10',       text: 'text-blue-700 dark:text-blue-400',       border: 'border-blue-100 dark:border-blue-500/20' },
    '#22c55e': { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-100 dark:border-emerald-500/20' },
    '#8b5cf6': { bg: 'bg-purple-50 dark:bg-purple-500/10',   text: 'text-purple-700 dark:text-purple-400',   border: 'border-purple-100 dark:border-purple-500/20' },
    '#f97316': { bg: 'bg-orange-50 dark:bg-orange-500/10',   text: 'text-orange-700 dark:text-orange-400',   border: 'border-orange-100 dark:border-orange-500/20' },
    '#ef4444': { bg: 'bg-red-50 dark:bg-red-500/10',         text: 'text-red-700 dark:text-red-400',         border: 'border-red-100 dark:border-red-500/20' },
    '#eab308': { bg: 'bg-yellow-50 dark:bg-yellow-500/10',   text: 'text-yellow-700 dark:text-yellow-400',   border: 'border-yellow-100 dark:border-yellow-500/20' },
    '#ec4899': { bg: 'bg-pink-50 dark:bg-pink-500/10',       text: 'text-pink-700 dark:text-pink-400',       border: 'border-pink-100 dark:border-pink-500/20' },
    '#06b6d4': { bg: 'bg-cyan-50 dark:bg-cyan-500/10',       text: 'text-cyan-700 dark:text-cyan-400',       border: 'border-cyan-100 dark:border-cyan-500/20' },
    '#14b8a6': { bg: 'bg-teal-50 dark:bg-teal-500/10',       text: 'text-teal-700 dark:text-teal-400',       border: 'border-teal-100 dark:border-teal-500/20' },
  };
  return MAP[color] || { bg: 'bg-gray-100 dark:bg-gray-500/10', text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-200 dark:border-gray-500/20' };
}

// ── Due date helper ──
function DueDate({ date }: { date: string }) {
  const due = new Date(date);
  const now = new Date();
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const isOverdue = diffDays < 0;
  const isSoon = diffDays >= 0 && diffDays <= 3;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[10px]',
      isOverdue ? 'text-red-500' : isSoon ? 'text-amber-500' : 'text-gray-400 dark:text-muted',
    )}>
      <Clock size={10} />
      {due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
    </span>
  );
}

// ── Type badge (icon + label) ──
function TypeBadge({ type, size = 'sm' }: { type: IssueType; size?: 'sm' | 'xs' }) {
  const cfg = typeConfig[type] ?? typeConfig.feature;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium border', cfg.bg, cfg.color,
      size === 'xs' ? 'text-[9px]' : 'text-[10px]',
      // border matching the bg
      type === 'bug' ? 'border-red-100 dark:border-red-500/20' :
      type === 'feature' ? 'border-purple-100 dark:border-purple-500/20' :
      type === 'improvement' ? 'border-blue-100 dark:border-blue-500/20' :
      'border-amber-100 dark:border-amber-500/20',
    )}>
      <Icon size={size === 'xs' ? 10 : 11} />
      {cfg.label}
    </span>
  );
}

export function KanbanCard({ issue, provided, isDragging, onClick, onContextMenu, projectTags = [], githubPrs = [] }: KanbanCardProps) {
  const handleContextMenu = (e: React.MouseEvent) => {
    if (onContextMenu) {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e, issue);
    }
  };
  const density = useUIStore((s) => s.density);
  const { resolveUserName, resolveUserAvatar } = useClerkMembers();
  const PriorityConfig = issue.priority ? (priorityConfig[issue.priority] ?? null) : null;
  const isDone = issue.status === 'done' || issue.status === 'cancelled';

  const getTagColor = (tagName: string): string => {
    const found = projectTags.find((t) => t.name === tagName);
    return found?.color || '#6b7280';
  };

  // ── Compact: single line ──
  if (density === 'compact') {
    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        role="article"
        aria-roledescription="draggable item"
        aria-label={`${issue.display_id}: ${issue.title}`}
        style={provided.draggableProps.style}
        className={cn(
          'group cursor-pointer rounded-md border border-gray-200 dark:border-border bg-white dark:bg-surface px-2.5 py-1.5 will-change-transform transition-all duration-200 shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-border',
          isDone && 'opacity-60 hover:opacity-90',
          isDragging && 'shadow-xl border-accent/30 rotate-1 scale-[1.02]',
        )}
      >
        <div className="flex items-center gap-2">
          {isDone ? (
            <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
          ) : PriorityConfig ? (
            <PriorityConfig.icon size={12} className={PriorityConfig.color} />
          ) : null}
          <span className="text-[10px] font-mono text-gray-400 dark:text-muted shrink-0">{issue.display_id}</span>
          <span className={cn(
            'text-xs font-medium truncate flex-1',
            isDone ? 'line-through text-gray-400 dark:text-muted' : 'text-gray-900 dark:text-primary',
          )}>{issue.title}</span>
          {issue.tags.slice(0, 1).map((tag) => {
            const style = getTagStyle(getTagColor(tag));
            return <span key={tag} className={cn('shrink-0 px-1.5 py-0 rounded text-[9px] font-medium border', style.bg, style.text, style.border)}>{tag}</span>;
          })}
          {issue.assignee_ids.length > 0 && (() => {
            const name = resolveUserName(issue.assignee_ids[0]);
            const avatar = resolveUserAvatar(issue.assignee_ids[0]);
            return (
              <img
                src={avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=f0f0f0&textColor=666666`}
                className="w-4 h-4 rounded-full ring-1 ring-white dark:ring-surface shrink-0"
                alt={name}
                title={name}
              />
            );
          })()}
        </div>
      </div>
    );
  }

  // ── Spacious: full details ──
  if (density === 'spacious') {
    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        role="article"
        aria-roledescription="draggable item"
        aria-label={`${issue.display_id}: ${issue.title}`}
        style={provided.draggableProps.style}
        className={cn(
          'group cursor-pointer rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-surface p-4 will-change-transform transition-all duration-200 shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-border',
          isDone && 'opacity-60 hover:opacity-90',
          isDragging && 'shadow-xl border-accent/30 rotate-1 scale-[1.02]',
        )}
      >
        {/* Header: ID + menu */}
        <div className="flex justify-between items-start mb-2">
          <span className="text-xs font-mono text-gray-400 dark:text-muted group-hover:text-gray-500 transition-colors">{issue.display_id}</span>
          <div className="p-1 rounded hover:bg-gray-100 dark:hover:bg-surface-hover text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Title */}
        <h3 className={cn(
          'text-sm font-medium leading-snug tracking-tight mb-2',
          isDone ? 'line-through text-gray-400 dark:text-muted' : 'text-gray-900 dark:text-primary',
        )}>
          {issue.title}
        </h3>

        {/* Description preview (not for done) */}
        {issue.description && !isDone && (() => {
          const preview = stripHtml(issue.description);
          return preview ? (
            <p className="text-xs text-gray-500 dark:text-muted leading-relaxed line-clamp-2 mb-3">
              {preview}
            </p>
          ) : null;
        })()}

        {/* Footer: type + tags + metadata */}
        <div className="flex items-center justify-between pt-2.5 border-t border-gray-100 dark:border-border/50">
          {/* Left: type badge + tags */}
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <TypeBadge type={issue.type} />
            {issue.tags.slice(0, 2).map((tag) => {
              const style = getTagStyle(getTagColor(tag));
              return <span key={tag} className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border', style.bg, style.text, style.border)}>{tag}</span>;
            })}
            {issue.tags.length > 2 && <span className="text-[10px] text-gray-400">+{issue.tags.length - 2}</span>}
          </div>

          {/* Right: priority + due + creator + assignee */}
          <div className="flex items-center gap-2 shrink-0">
            {githubPrs.length > 0 && <GitHubPrBadge prs={githubPrs} />}
            {issue.due_date && <DueDate date={issue.due_date} />}
            {isDone ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            ) : PriorityConfig ? (
              <PriorityConfig.icon className={cn('w-3.5 h-3.5', PriorityConfig.color)} />
            ) : null}
            {(issue.created_by_name || issue.created_by_id) && (() => {
              const name = resolveUserName(issue.created_by_id, issue.created_by_name);
              return (
                <span className="text-[10px] text-gray-400 dark:text-muted flex items-center gap-0.5" title={`Created by ${name}`}>
                  <User size={10} />
                  {name.split(' ')[0]}
                </span>
              );
            })()}
            {issue.assignee_ids.length > 0 ? (
              <div className="flex -space-x-1.5">
                {issue.assignee_ids.slice(0, 2).map((id) => {
                  const name = resolveUserName(id);
                  const avatar = resolveUserAvatar(id);
                  return (
                    <img
                      key={id}
                      src={avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=f0f0f0&textColor=666666`}
                      className="w-5 h-5 rounded-full ring-1 ring-white dark:ring-surface"
                      alt={name}
                      title={name}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // ── Default: balanced Linear-style ──
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      onClick={onClick}
        onContextMenu={handleContextMenu}
      role="article"
      aria-roledescription="draggable item"
      aria-label={`${issue.display_id}: ${issue.title}`}
      style={provided.draggableProps.style}
      className={cn(
        'group cursor-pointer rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-surface p-4 will-change-transform transition-all duration-200 shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-border',
        isDone && 'opacity-75 hover:opacity-100',
        isDragging && 'shadow-xl border-accent/30 rotate-1 scale-[1.02]',
      )}
    >
      {/* Top row: ID + three-dot menu */}
      <div className="flex justify-between items-start mb-2">
        <span className="text-xs font-mono text-gray-400 dark:text-muted group-hover:text-gray-500 dark:group-hover:text-secondary transition-colors">
          {issue.display_id}
        </span>
        <div
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-surface-hover text-gray-400 dark:text-muted opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Title */}
      <h3 className={cn(
        'text-sm font-medium mb-3 leading-snug tracking-tight line-clamp-2',
        isDone ? 'line-through text-gray-400 dark:text-muted' : 'text-gray-900 dark:text-primary',
      )}>
        {issue.title}
      </h3>

      {/* Footer: type + tags left — priority + creator + assignee right */}
      <div className="flex items-center justify-between">
        {/* Left: type badge + tags */}
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <TypeBadge type={issue.type} size="xs" />
          {issue.tags.slice(0, 2).map((tag) => {
            const style = getTagStyle(getTagColor(tag));
            return (
              <span key={tag} className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', style.bg, style.text, style.border)}>
                {tag}
              </span>
            );
          })}
          {issue.due_date && <DueDate date={issue.due_date} />}
        </div>

        {/* Right: priority/done + creator + assignee */}
        <div className="flex items-center gap-2 shrink-0">
          {githubPrs.length > 0 && <GitHubPrBadge prs={githubPrs} />}
          {isDone ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          ) : PriorityConfig ? (
            <PriorityConfig.icon className={cn('w-3.5 h-3.5', PriorityConfig.color)} />
          ) : null}
          {(issue.created_by_name || issue.created_by_id) && (() => {
            const name = resolveUserName(issue.created_by_id, issue.created_by_name);
            return (
              <span className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-muted" title={`Created by ${name}`}>
                <User size={10} />
              </span>
            );
          })()}
          {issue.assignee_ids.length > 0 && (() => {
            const name = resolveUserName(issue.assignee_ids[0]);
            const avatar = resolveUserAvatar(issue.assignee_ids[0]);
            return (
              <img
                src={avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=f0f0f0&textColor=666666`}
                className="w-5 h-5 rounded-full ring-1 ring-white dark:ring-surface"
                alt={name}
                title={name}
              />
            );
          })()}
        </div>
      </div>
    </div>
  );
}
