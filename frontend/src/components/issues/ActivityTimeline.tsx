import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import {
  ArrowRight, MessageSquare, Plus, UserCheck, Flag,
  AlertCircle, Tag, Clock, Archive, RefreshCw,
} from 'lucide-react';

interface ActivityEntry {
  id: string;
  issue_id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  issue_created: { icon: Plus, label: 'created this issue', color: 'text-green-400' },
  status_changed: { icon: ArrowRight, label: 'changed status', color: 'text-blue-400' },
  priority_changed: { icon: Flag, label: 'changed priority', color: 'text-orange-400' },
  assignee_changed: { icon: UserCheck, label: 'changed assignee', color: 'text-purple-400' },
  comment_added: { icon: MessageSquare, label: 'commented', color: 'text-cyan-400' },
  tag_added: { icon: Tag, label: 'added tag', color: 'text-teal-400' },
  tag_removed: { icon: Tag, label: 'removed tag', color: 'text-gray-400' },
  estimate_changed: { icon: Clock, label: 'changed estimate', color: 'text-yellow-400' },
  archived: { icon: Archive, label: 'archived', color: 'text-gray-500' },
  unarchived: { icon: RefreshCw, label: 'unarchived', color: 'text-green-400' },
};

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-gray-500/20 text-gray-400',
  todo: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  in_review: 'bg-purple-500/20 text-purple-400',
  done: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-red-500/20 text-red-400',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500/20 text-red-400',
  high: 'bg-orange-500/20 text-orange-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-blue-500/20 text-blue-400',
};

function ValueBadge({ value, type }: { value: string; type: 'status' | 'priority' | 'text' }) {
  if (type === 'status') {
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[value] || 'bg-gray-500/20 text-gray-400'}`}>
        {STATUS_LABELS[value] || value}
      </span>
    );
  }
  if (type === 'priority') {
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${PRIORITY_COLORS[value] || 'bg-gray-500/20 text-gray-400'}`}>
        {PRIORITY_LABELS[value] || value}
      </span>
    );
  }
  return <span className="text-[11px] text-primary font-medium">{value}</span>;
}

function RelativeTime({ date }: { date: string }) {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  let text: string;
  if (diffMin < 1) text = 'just now';
  else if (diffMin < 60) text = `${diffMin}m ago`;
  else if (diffHr < 24) text = `${diffHr}h ago`;
  else if (diffDay < 7) text = `${diffDay}d ago`;
  else text = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return <span className="text-[10px] text-muted shrink-0" title={d.toLocaleString()}>{text}</span>;
}

export function ActivityTimeline({ issueId }: { issueId: string }) {
  const apiClient = useApi();

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['activity', issueId],
    queryFn: () => apiClient.get<ActivityEntry[]>(`/issues/${issueId}/activity`),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-6 h-6 rounded-full bg-surface-hover" />
            <div className="flex-1 h-4 bg-surface-hover rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted">
        No activity yet
      </div>
    );
  }

  // Group entries by minute (same user + same minute = grouped)
  const grouped: { entries: ActivityEntry[]; key: string }[] = [];
  for (const entry of activities) {
    const lastGroup = grouped[grouped.length - 1];
    if (lastGroup) {
      const lastEntry = lastGroup.entries[lastGroup.entries.length - 1];
      const sameUser = lastEntry.user_id === entry.user_id;
      const sameMinute = Math.abs(new Date(lastEntry.created_at).getTime() - new Date(entry.created_at).getTime()) < 60000;
      if (sameUser && sameMinute) {
        lastGroup.entries.push(entry);
        continue;
      }
    }
    grouped.push({ entries: [entry], key: entry.id });
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" />

      <div className="space-y-0">
        {grouped.map(group => {
          const first = group.entries[0];
          const config = ACTION_CONFIG[first.action] || { icon: AlertCircle, label: first.action, color: 'text-gray-400' };
          const Icon = config.icon;

          return (
            <div key={group.key} className="relative flex gap-3 py-2 group">
              {/* Icon */}
              <div className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-surface border border-border ${config.color}`}>
                <Icon size={12} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-medium text-primary">
                    {first.user_name || 'System'}
                  </span>

                  {group.entries.map(entry => {
                    const entryConfig = ACTION_CONFIG[entry.action] || config;
                    const fieldType = entry.field === 'status' ? 'status' as const
                      : entry.field === 'priority' ? 'priority' as const
                      : 'text' as const;

                    return (
                      <span key={entry.id} className="inline-flex items-center gap-1 text-[11px] text-secondary">
                        <span>{entryConfig.label}</span>
                        {entry.old_value && entry.new_value && (
                          <>
                            <ValueBadge value={entry.old_value} type={fieldType} />
                            <ArrowRight size={10} className="text-muted" />
                            <ValueBadge value={entry.new_value} type={fieldType} />
                          </>
                        )}
                        {!entry.old_value && entry.new_value && (
                          <ValueBadge value={entry.new_value} type={fieldType} />
                        )}
                      </span>
                    );
                  })}

                  <RelativeTime date={first.created_at} />
                </div>

                {/* Comment preview from metadata */}
                {first.action === 'comment_added' && first.metadata && (
                  <p className="mt-0.5 text-[11px] text-muted truncate max-w-md">
                    {String((first.metadata as Record<string, unknown>).preview || '')}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
