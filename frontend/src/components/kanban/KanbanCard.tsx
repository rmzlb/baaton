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

export function KanbanCard({ issue, provided, isDragging, onClick, projectTags = [] }: KanbanCardProps) {
  const density = useUIStore((s) => s.density);
  const TypeIcon = typeIcons[issue.type] ?? Sparkles;
  const PriorityConfig = issue.priority ? (priorityConfig[issue.priority] ?? null) : null;

  const getTagColor = (tagName: string): string => {
    const found = projectTags.find((t) => t.name === tagName);
    return found?.color || '#6b7280';
  };

  // ── Compact: single line, minimal info ──
  if (density === 'compact') {
    return (
      <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        onClick={onClick}
        className={cn(
          'cursor-pointer rounded-md border border-[#262626] bg-[#141414] px-2.5 py-1.5 transition-all hover:border-[#333]',
          isDragging && 'shadow-xl shadow-black/40 border-[#f59e0b]/30 rotate-1',
        )}
      >
        <div className="flex items-center gap-2">
          {PriorityConfig && (
            <PriorityConfig.icon size={12} className={PriorityConfig.color} />
          )}
          <TypeIcon size={12} className={typeColors[issue.type]} />
          <span className="text-[10px] font-mono text-[#666] shrink-0">{issue.display_id}</span>
          <span className="text-xs text-[#fafafa] font-medium truncate flex-1">{issue.title}</span>
          {issue.assignee_ids.length > 0 && (
            <div className="h-4 w-4 rounded-full bg-[#1f1f1f] flex items-center justify-center text-[7px] font-mono text-[#a1a1aa] shrink-0">
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
        className={cn(
          'cursor-pointer rounded-lg border border-[#262626] bg-[#141414] p-4 transition-all hover:border-[#333]',
          isDragging && 'shadow-xl shadow-black/40 border-[#f59e0b]/30 rotate-1',
        )}
      >
        {/* Header: ID + Priority + Type */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TypeIcon size={14} className={typeColors[issue.type]} />
            <span className="text-[11px] font-mono text-[#a1a1aa]">{issue.display_id}</span>
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
        <p className="text-sm font-medium text-[#fafafa] leading-snug mb-1.5">
          {issue.title}
        </p>

        {/* Description preview */}
        {issue.description && (
          <p className="text-xs text-[#666] leading-relaxed line-clamp-2 mb-2.5">
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
        <div className="flex items-center justify-between pt-2 border-t border-[#1f1f1f]">
          <div className="flex items-center gap-2">
            {issue.assignee_ids.length > 0 && (
              <div className="flex -space-x-1.5">
                {issue.assignee_ids.slice(0, 3).map((id) => (
                  <div
                    key={id}
                    className="h-6 w-6 rounded-full bg-[#1f1f1f] border border-[#141414] flex items-center justify-center text-[8px] font-mono text-[#a1a1aa]"
                  >
                    {id.slice(0, 2).toUpperCase()}
                  </div>
                ))}
                {issue.assignee_ids.length > 3 && (
                  <div className="h-6 w-6 rounded-full bg-[#1f1f1f] border border-[#141414] flex items-center justify-center text-[8px] font-mono text-[#666]">
                    +{issue.assignee_ids.length - 3}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {issue.comments && issue.comments.length > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-[#555]">
                <MessageSquare size={10} />
                {issue.comments.length}
              </span>
            )}
            {issue.tldrs && issue.tldrs.length > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-[#f59e0b] font-mono">
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
      className={cn(
        'cursor-pointer rounded-lg border border-[#262626] bg-[#141414] p-3 transition-all hover:border-[#333] min-h-[44px]',
        isDragging && 'shadow-xl shadow-black/40 border-[#f59e0b]/30 rotate-1',
      )}
    >
      {/* Top row: ID + Priority */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-mono text-[#a1a1aa]">
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
      <p className="text-sm font-medium text-[#fafafa] leading-snug line-clamp-2">
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
          <span className="text-[10px] text-[#666]">+{issue.tags.length - 3}</span>
        )}
        {issue.assignee_ids.length > 0 && (
          <div className="ml-auto flex -space-x-1.5">
            {issue.assignee_ids.slice(0, 2).map((id) => (
              <div
                key={id}
                className="h-5 w-5 rounded-full bg-[#1f1f1f] border border-[#141414] flex items-center justify-center text-[8px] font-mono text-[#a1a1aa]"
              >
                {id.slice(0, 2).toUpperCase()}
              </div>
            ))}
          </div>
        )}
        {issue.tldrs && issue.tldrs.length > 0 && (
          <span className="ml-auto flex items-center gap-0.5 text-[10px] text-[#f59e0b] font-mono">
            <Bot size={10} /> TLDR
          </span>
        )}
      </div>
    </div>
  );
}
