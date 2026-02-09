import type { DraggableProvided } from '@hello-pangea/dnd';
import {
  Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, AlertTriangle, Bot, MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';
import type { Issue, IssuePriority, IssueType, ProjectTag } from '@/lib/types';

interface KanbanCardProps {
  issue: Issue;
  provided: DraggableProvided;
  isDragging: boolean;
  onClick: () => void;
  projectTags?: ProjectTag[];
}

const typeIcons: Record<IssueType, typeof Bug> = {
  bug: Bug,
  feature: Sparkles,
  improvement: Zap,
  question: HelpCircle,
};

const typeColors: Record<IssueType, string> = {
  bug: 'text-red-400',
  feature: 'text-emerald-400',
  improvement: 'text-blue-400',
  question: 'text-purple-400',
};

const priorityConfig: Record<IssuePriority, { icon: typeof ArrowUp; color: string; label: string }> = {
  urgent: { icon: AlertTriangle, color: 'text-red-500', label: 'Urgent' },
  high: { icon: ArrowUp, color: 'text-orange-400', label: 'High' },
  medium: { icon: Minus, color: 'text-yellow-400', label: 'Medium' },
  low: { icon: ArrowDown, color: 'text-gray-400', label: 'Low' },
};

// Priority → left border color (Linear-style)
const PRIORITY_BORDER: Record<IssuePriority, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#9ca3af',
};

// Category tag colors
const CATEGORY_COLORS: Record<string, string> = {
  FRONT: '#3b82f6',
  BACK: '#22c55e',
  API: '#8b5cf6',
  DB: '#f97316',
};

export function KanbanCard({ issue, provided, isDragging, onClick, projectTags = [] }: KanbanCardProps) {
  const density = useUIStore((s) => s.density);
  const TypeIcon = typeIcons[issue.type] ?? Sparkles;
  const PriorityConfig = issue.priority ? (priorityConfig[issue.priority] ?? null) : null;

  const getTagColor = (tagName: string): string => {
    const found = projectTags.find((t) => t.name === tagName);
    return found?.color || '#6b7280';
  };

  // Left border style based on priority
  const borderStyle = issue.priority && PRIORITY_BORDER[issue.priority]
    ? { borderLeft: `4px solid ${PRIORITY_BORDER[issue.priority]}` }
    : {};

  // Category badges component
  const CategoryBadges = () => {
    const categories = issue.category || [];
    if (categories.length === 0) return null;
    return (
      <div className="flex items-center gap-1 flex-wrap mb-1">
        {categories.map((cat) => {
          const color = CATEGORY_COLORS[cat.toUpperCase()] || '#6b7280';
          return (
            <span
              key={cat}
              className="rounded px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: `${color}20`,
                color: color,
              }}
            >
              {cat}
            </span>
          );
        })}
      </div>
    );
  };

  // ── Compact: single line, minimal info ──
  if (density === 'compact') {
    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        onClick={onClick}
        style={{ ...provided.draggableProps.style, ...borderStyle }}
        className={cn(
          'cursor-pointer rounded-md border border-border bg-surface px-2.5 py-1.5 transition-all hover:border-border',
          isDragging && 'shadow-xl shadow-black/20 dark:shadow-black/40 border-accent/30 rotate-1',
        )}
      >
        <CategoryBadges />
        <div className="flex items-center gap-2">
          {PriorityConfig && (
            <PriorityConfig.icon size={12} className={PriorityConfig.color} />
          )}
          <TypeIcon size={12} className={typeColors[issue.type]} />
          <span className="text-[10px] font-mono text-muted shrink-0">{issue.display_id}</span>
          <span className="text-xs text-primary font-medium truncate flex-1">{issue.title}</span>
          {issue.assignee_ids.length > 0 && (
            <div className="h-4 w-4 rounded-full bg-surface-hover flex items-center justify-center text-[7px] font-mono text-secondary shrink-0">
              {issue.assignee_ids[0].slice(0, 2).toUpperCase()}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Spacious: full details, description preview ──
  if (density === 'spacious') {
    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        onClick={onClick}
        style={{ ...provided.draggableProps.style, ...borderStyle }}
        className={cn(
          'cursor-pointer rounded-lg border border-border bg-surface p-4 transition-all hover:border-border',
          isDragging && 'shadow-xl shadow-black/20 dark:shadow-black/40 border-accent/30 rotate-1',
        )}
      >
        {/* Category badges */}
        <CategoryBadges />

        {/* Header: ID + Priority + Type */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TypeIcon size={14} className={typeColors[issue.type]} />
            <span className="text-[11px] font-mono text-secondary">{issue.display_id}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {PriorityConfig && (
              <span className="flex items-center gap-1 text-[10px]" style={{ color: PriorityConfig.color === 'text-red-500' ? '#ef4444' : PriorityConfig.color === 'text-orange-400' ? '#f97316' : PriorityConfig.color === 'text-yellow-400' ? '#eab308' : '#6b7280' }}>
                <PriorityConfig.icon size={12} className={PriorityConfig.color} />
                {PriorityConfig.label}
              </span>
            )}
          </div>
        </div>

        {/* Title */}
        <p className="text-sm font-medium text-primary leading-snug mb-1.5">
          {issue.title}
        </p>

        {/* Description preview */}
        {issue.description && (
          <p className="text-xs text-muted leading-relaxed line-clamp-2 mb-2.5">
            {issue.description}
          </p>
        )}

        {/* Tags row */}
        {issue.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-2.5">
            {issue.tags.map((tag) => {
              const color = getTagColor(tag);
              return (
                <span
                  key={tag}
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium border"
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
          </div>
        )}

        {/* Footer: Assignees + Indicators */}
        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            {issue.assignee_ids.length > 0 && (
              <div className="flex -space-x-1.5">
                {issue.assignee_ids.slice(0, 3).map((id) => (
                  <div
                    key={id}
                    className="h-6 w-6 rounded-full bg-surface-hover border border-surface flex items-center justify-center text-[8px] font-mono text-secondary"
                  >
                    {id.slice(0, 2).toUpperCase()}
                  </div>
                ))}
                {issue.assignee_ids.length > 3 && (
                  <div className="h-6 w-6 rounded-full bg-surface-hover border border-surface flex items-center justify-center text-[8px] font-mono text-muted">
                    +{issue.assignee_ids.length - 3}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {issue.comments && issue.comments.length > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted">
                <MessageSquare size={10} />
                {issue.comments.length}
              </span>
            )}
            {issue.tldrs && issue.tldrs.length > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-accent font-mono">
                <Bot size={10} /> TLDR
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Default: balanced view ──
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      {...provided.dragHandleProps}
      onClick={onClick}
      style={{ ...provided.draggableProps.style, ...borderStyle }}
      className={cn(
        'cursor-pointer rounded-lg border border-border bg-surface p-3 transition-all hover:border-border min-h-[44px]',
        isDragging && 'shadow-xl shadow-black/20 dark:shadow-black/40 border-accent/30 rotate-1',
      )}
    >
      {/* Category badges */}
      <CategoryBadges />

      {/* Top row: ID + Priority */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-mono text-secondary">
          {issue.display_id}
        </span>
        {PriorityConfig && (
          <PriorityConfig.icon
            size={14}
            className={PriorityConfig.color}
          />
        )}
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-primary leading-snug line-clamp-2">
        {issue.title}
      </p>

      {/* Bottom row: Type + Tags + Assignee */}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <TypeIcon
          size={14}
          className={typeColors[issue.type]}
        />
        {issue.tags.slice(0, 3).map((tag) => {
          const color = getTagColor(tag);
          return (
            <span
              key={tag}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium border"
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
        {issue.tags.length > 3 && (
          <span className="text-[10px] text-muted">+{issue.tags.length - 3}</span>
        )}
        {issue.assignee_ids.length > 0 && (
          <div className="ml-auto flex -space-x-1.5">
            {issue.assignee_ids.slice(0, 2).map((id) => (
              <div
                key={id}
                className="h-5 w-5 rounded-full bg-surface-hover border border-surface flex items-center justify-center text-[8px] font-mono text-secondary"
              >
                {id.slice(0, 2).toUpperCase()}
              </div>
            ))}
          </div>
        )}
        {issue.tldrs && issue.tldrs.length > 0 && (
          <span className="ml-auto flex items-center gap-0.5 text-[10px] text-accent font-mono">
            <Bot size={10} /> TLDR
          </span>
        )}
      </div>
    </div>
  );
}
