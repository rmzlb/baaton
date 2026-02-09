import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-react';
import {
  CheckSquare, Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, AlertTriangle,
} from 'lucide-react';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { timeAgo } from '@/lib/utils';
import type { Issue, IssuePriority, IssueType } from '@/lib/types';

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

const statusColors: Record<string, string> = {
  backlog: '#6b7280',
  todo: '#3b82f6',
  in_progress: '#f59e0b',
  in_review: '#8b5cf6',
  done: '#22c55e',
  cancelled: '#ef4444',
};

export function MyTasks() {
  const { user } = useUser();
  const apiClient = useApi();
  const openDetail = useIssuesStore((s) => s.openDetail);
  const closeDetail = useIssuesStore((s) => s.closeDetail);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);

  // Fetch all projects for name mapping
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
  });

  // Fetch my issues
  const { data: myIssues = [], isLoading } = useQuery({
    queryKey: ['my-issues', user?.id],
    queryFn: () => apiClient.issues.listMine(user!.id),
    enabled: !!user?.id,
  });

  // Group by project
  const groupedByProject = myIssues.reduce(
    (acc, issue) => {
      if (!acc[issue.project_id]) acc[issue.project_id] = [];
      acc[issue.project_id].push(issue);
      return acc;
    },
    {} as Record<string, Issue[]>,
  );

  const getProjectName = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    return project?.name || projectId;
  };

  const getProjectPrefix = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    return project?.prefix || '';
  };

  // Find the selected issue to get its project_id for the drawer
  const selectedIssue = myIssues.find((i) => i.id === selectedIssueId);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#a1a1aa]">
        Loading your tasks…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#262626] px-4 md:px-6 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-[#fafafa] flex items-center gap-2">
            <CheckSquare size={20} className="text-[#f59e0b]" />
            My Tasks
          </h1>
          <p className="text-xs text-[#a1a1aa] font-mono uppercase tracking-wider">
            {myIssues.length} issue{myIssues.length !== 1 ? 's' : ''} assigned to you
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {Object.keys(groupedByProject).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CheckSquare size={40} className="text-[#333] mb-3" />
            <p className="text-sm text-[#a1a1aa]">No tasks assigned to you</p>
            <p className="text-xs text-[#555] mt-1">Issues you're assigned to will appear here.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedByProject).map(([projectId, issues]) => (
              <div key={projectId}>
                {/* Project Header */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-6 w-6 rounded-md bg-[#f59e0b]/20 flex items-center justify-center text-[10px] font-bold text-[#f59e0b]">
                    {getProjectPrefix(projectId).slice(0, 2)}
                  </div>
                  <h2 className="text-sm font-semibold text-[#fafafa]">
                    {getProjectName(projectId)}
                  </h2>
                  <span className="rounded-full bg-[#1f1f1f] px-2 py-0.5 text-[10px] text-[#666] font-mono">
                    {issues.length}
                  </span>
                </div>

                {/* Issue rows */}
                <div className="rounded-lg border border-[#262626] bg-[#141414] overflow-hidden">
                  {issues.map((issue, idx) => {
                    const TypeIcon = typeIcons[issue.type] ?? Sparkles;
                    const priority = issue.priority ? priorityConfig[issue.priority] : null;
                    const PriorityIcon = priority?.icon;

                    return (
                      <div
                        key={issue.id}
                        onClick={() => openDetail(issue.id)}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#1a1a1a] transition-colors min-h-[44px] ${
                          idx < issues.length - 1 ? 'border-b border-[#1f1f1f]' : ''
                        }`}
                      >
                        {/* Status dot */}
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: statusColors[issue.status] || '#6b7280' }}
                        />

                        {/* Type icon */}
                        <TypeIcon size={14} className={typeColors[issue.type]} />

                        {/* ID */}
                        <span className="text-[11px] font-mono text-[#666] shrink-0">
                          {issue.display_id}
                        </span>

                        {/* Title */}
                        <span className="text-sm text-[#fafafa] font-medium truncate flex-1">
                          {issue.title}
                        </span>

                        {/* Priority */}
                        {PriorityIcon && (
                          <PriorityIcon size={14} style={{ color: priority?.color }} />
                        )}

                        {/* Tags */}
                        {issue.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-[#1f1f1f] px-2 py-0.5 text-[9px] text-[#a1a1aa] hidden sm:inline"
                          >
                            {tag}
                          </span>
                        ))}

                        {/* Updated */}
                        <span className="text-[10px] text-[#555] shrink-0 hidden md:inline">
                          {timeAgo(issue.updated_at)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Issue Detail Drawer */}
      {isDetailOpen && selectedIssueId && (
        <IssueDrawer
          issueId={selectedIssueId}
          projectId={selectedIssue?.project_id}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}
