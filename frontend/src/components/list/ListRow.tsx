import {
  Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, AlertTriangle,
} from 'lucide-react';
import { timeAgo } from '@/lib/utils';
import type { Issue, IssuePriority, IssueType, ProjectStatus, ProjectTag } from '@/lib/types';

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
  urgent: { icon: AlertTriangle, color: '#ef4444', label: 'Urgent' },
  high: { icon: ArrowUp, color: '#f97316', label: 'High' },
  medium: { icon: Minus, color: '#eab308', label: 'Medium' },
  low: { icon: ArrowDown, color: '#6b7280', label: 'Low' },
};

interface ListRowProps {
  issue: Issue;
  statuses: ProjectStatus[];
  projectTags?: ProjectTag[];
  onClick: () => void;
}

export function ListRow({ issue, statuses, projectTags = [], onClick }: ListRowProps) {
  const TypeIcon = typeIcons[issue.type] ?? Sparkles;
  const status = statuses.find((s) => s.key === issue.status);
  const priority = issue.priority ? priorityConfig[issue.priority] : null;
  const PriorityIcon = priority?.icon;

  const getTagColor = (tagName: string): string => {
    const found = projectTags.find((t) => t.name === tagName);
    return found?.color || '#6b7280';
  };

  return (
    <div
      onClick={onClick}
      className="grid grid-cols-[80px_1fr_120px_100px_90px_120px_80px_100px] gap-2 border-b border-[#1a1a1a] px-4 md:px-6 py-2.5 text-xs cursor-pointer hover:bg-[#141414] transition-colors items-center min-h-[44px]"
    >
      {/* ID */}
      <span className="font-mono text-[#a1a1aa] text-[11px] truncate">{issue.display_id}</span>

      {/* Title */}
      <span className="text-[#fafafa] font-medium truncate">{issue.title}</span>

      {/* Status */}
      <span className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: status?.color }}
        />
        <span className="text-[#a1a1aa] truncate">{status?.label || issue.status}</span>
      </span>

      {/* Priority */}
      <span className="flex items-center gap-1.5">
        {PriorityIcon && (
          <PriorityIcon size={12} style={{ color: priority?.color }} />
        )}
        <span className="text-[#a1a1aa]">{priority?.label || '—'}</span>
      </span>

      {/* Type */}
      <span className="flex items-center gap-1.5">
        <TypeIcon size={12} className={typeColors[issue.type]} />
        <span className="text-[#a1a1aa] capitalize truncate">{issue.type}</span>
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
          <span className="text-[9px] text-[#555]">+{issue.tags.length - 2}</span>
        )}
      </span>

      {/* Assignees */}
      <span className="flex -space-x-1">
        {issue.assignee_ids.slice(0, 2).map((id) => (
          <div
            key={id}
            className="h-5 w-5 rounded-full bg-[#1f1f1f] border border-[#0a0a0a] flex items-center justify-center text-[7px] font-mono text-[#a1a1aa]"
          >
            {id.slice(0, 2).toUpperCase()}
          </div>
        ))}
        {issue.assignee_ids.length === 0 && <span className="text-[#555]">—</span>}
      </span>

      {/* Updated */}
      <span className="text-[#666] text-[10px]">{timeAgo(issue.updated_at)}</span>
    </div>
  );
}
