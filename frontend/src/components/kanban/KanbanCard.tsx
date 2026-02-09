import type { DraggableProvided } from '@hello-pangea/dnd';
import {
  Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, AlertTriangle, Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Issue, IssuePriority, IssueType } from '@/lib/types';

interface KanbanCardProps {
  issue: Issue;
  provided: DraggableProvided;
  isDragging: boolean;
  onClick: () => void;
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

const priorityConfig: Record<IssuePriority, { icon: typeof ArrowUp; color: string }> = {
  urgent: { icon: AlertTriangle, color: 'text-red-500' },
  high: { icon: ArrowUp, color: 'text-orange-400' },
  medium: { icon: Minus, color: 'text-yellow-400' },
  low: { icon: ArrowDown, color: 'text-gray-400' },
};

export function KanbanCard({ issue, provided, isDragging, onClick }: KanbanCardProps) {
  const TypeIcon = typeIcons[issue.type];
  const PriorityConfig = issue.priority ? priorityConfig[issue.priority] : null;

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
      <div className="mt-2 flex items-center gap-2">
        <TypeIcon
          size={14}
          className={typeColors[issue.type]}
        />
        {issue.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-[#1f1f1f] px-2 py-0.5 text-[10px] text-[#a1a1aa]"
          >
            {tag}
          </span>
        ))}
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
