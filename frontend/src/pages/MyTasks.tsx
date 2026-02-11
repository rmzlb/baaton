import { useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-react';
import {
  CheckSquare, Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, OctagonAlert,
} from 'lucide-react';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { useTranslation } from '@/hooks/useTranslation';
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

const priorityConfig: Record<IssuePriority, { icon: typeof ArrowUp; color: string }> = {
  urgent: { icon: OctagonAlert, color: '#ef4444' },
  high: { icon: ArrowUp, color: '#f97316' },
  medium: { icon: Minus, color: '#eab308' },
  low: { icon: ArrowDown, color: '#6b7280' },
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
  const { t } = useTranslation();
  const { user } = useUser();
  const apiClient = useApi();
  const openDetail = useIssuesStore((s) => s.openDetail);
  const closeDetail = useIssuesStore((s) => s.closeDetail);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);
  const [, setSearchParams] = useSearchParams();
  const initialIssueParam = useRef(new URLSearchParams(window.location.search).get('issue'));

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

  // ── Deep link: open from ?issue=HLM-18 on initial load ONCE ──
  useEffect(() => {
    const param = initialIssueParam.current;
    if (!param || myIssues.length === 0) return;
    const found = myIssues.find((i) => i.display_id.toLowerCase() === param.toLowerCase());
    if (found) openDetail(found.id);
    initialIssueParam.current = null;
  }, [myIssues, openDetail]);

  useEffect(() => {
    if (isDetailOpen && selectedIssueId) {
      const issue = myIssues.find((i) => i.id === selectedIssueId);
      if (issue) {
        setSearchParams((prev) => { prev.set('issue', issue.display_id); return prev; }, { replace: true });
      }
    }
  }, [isDetailOpen, selectedIssueId, myIssues, setSearchParams]);

  const handleCloseDetail = useCallback(() => {
    closeDetail();
    setSearchParams((prev) => { prev.delete('issue'); return prev; }, { replace: true });
  }, [closeDetail, setSearchParams]);

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
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        {t('myTasks.loading')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 md:px-6 py-3">
        <div className="min-w-0">
          <h1 className="text-base md:text-lg font-semibold text-primary flex items-center gap-2">
            <CheckSquare size={18} className="text-accent shrink-0 md:w-5 md:h-5" />
            {t('myTasks.title')}
          </h1>
          <p className="text-[10px] md:text-xs text-secondary font-mono uppercase tracking-wider">
            {t('myTasks.assignedToYou', { count: myIssues.length })}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 md:p-6">
        {Object.keys(groupedByProject).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CheckSquare size={40} className="text-border mb-3" />
            <p className="text-sm text-secondary">{t('myTasks.noTasks')}</p>
            <p className="text-xs text-muted mt-1">{t('myTasks.noTasksDesc')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedByProject).map(([projectId, issues]) => (
              <div key={projectId}>
                {/* Project Header */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-6 w-6 rounded-md bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">
                    {getProjectPrefix(projectId).slice(0, 2)}
                  </div>
                  <h2 className="text-sm font-semibold text-primary">
                    {getProjectName(projectId)}
                  </h2>
                  <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-muted font-mono">
                    {issues.length}
                  </span>
                </div>

                {/* Issue rows */}
                <div className="rounded-lg border border-border bg-surface overflow-hidden">
                  {issues.map((issue, idx) => {
                    const TypeIcon = typeIcons[issue.type] ?? Sparkles;
                    const priority = issue.priority ? priorityConfig[issue.priority] : null;
                    const PriorityIcon = priority?.icon;

                    return (
                      <div
                        key={issue.id}
                        onClick={() => openDetail(issue.id)}
                        className={`flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors min-h-[44px] ${
                          idx < issues.length - 1 ? 'border-b border-border/50' : ''
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
                        <span className="text-[11px] font-mono text-muted shrink-0">
                          {issue.display_id}
                        </span>

                        {/* Title */}
                        <span className="text-sm text-primary font-medium truncate flex-1">
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
                            className="rounded-full bg-surface-hover px-2 py-0.5 text-[9px] text-secondary hidden sm:inline"
                          >
                            {tag}
                          </span>
                        ))}

                        {/* Updated */}
                        <span className="text-[10px] text-muted shrink-0 hidden md:inline">
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
          onClose={handleCloseDetail}
        />
      )}
    </div>
  );
}

export default MyTasks;
