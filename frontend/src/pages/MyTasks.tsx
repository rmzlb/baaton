import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-react';
import {
  CheckSquare, Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, OctagonAlert,
  ChevronDown, ChevronRight, Inbox,
} from 'lucide-react';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { useApi } from '@/hooks/useApi';
import { useIssuesStore } from '@/stores/issues';
import { useTranslation } from '@/hooks/useTranslation';
import { timeAgo, cn } from '@/lib/utils';
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

type Tab = 'assigned' | 'created' | 'activity';

interface FocusSection {
  key: string;
  icon: string;
  label: string;
  filter: (issue: Issue) => boolean;
  collapsedByDefault?: boolean;
}

const FOCUS_SECTIONS: FocusSection[] = [
  {
    key: 'urgent',
    icon: '🔴',
    label: 'Urgent',
    filter: (i) => i.priority === 'urgent' && i.status !== 'done' && i.status !== 'cancelled',
  },
  {
    key: 'high',
    icon: '🟠',
    label: 'High Priority',
    filter: (i) => i.priority === 'high' && i.status !== 'done' && i.status !== 'cancelled',
  },
  {
    key: 'in_progress',
    icon: '🔵',
    label: 'In Progress',
    filter: (i) => i.status === 'in_progress',
  },
  {
    key: 'todo',
    icon: '📋',
    label: 'Todo',
    filter: (i) => i.status === 'todo',
  },
  {
    key: 'backlog',
    icon: '📥',
    label: 'Backlog',
    filter: (i) => i.status === 'backlog',
  },
  {
    key: 'completed',
    icon: '✅',
    label: 'Completed',
    filter: (i) => i.status === 'done',
    collapsedByDefault: true,
  },
];

function IssueRow({ issue, onClick }: { issue: Issue; onClick: () => void }) {
  const TypeIcon = typeIcons[issue.type] ?? Sparkles;
  const priority = issue.priority ? priorityConfig[issue.priority] : null;
  const PriorityIcon = priority?.icon;

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors min-h-[44px] border-b border-border/50 last:border-b-0"
    >
      <span
        className="h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: statusColors[issue.status] || '#6b7280' }}
      />
      <TypeIcon size={14} className={typeColors[issue.type]} />
      <span className="text-[11px] font-mono text-muted shrink-0">{issue.display_id}</span>
      <span className="text-sm text-primary font-medium truncate flex-1">{issue.title}</span>
      {PriorityIcon && <PriorityIcon size={14} style={{ color: priority?.color }} />}
      {issue.tags.slice(0, 2).map((tag) => (
        <span key={tag} className="rounded-full bg-surface-hover px-2 py-0.5 text-[9px] text-secondary hidden sm:inline">
          {tag}
        </span>
      ))}
      <span className="text-[10px] text-muted shrink-0 hidden md:inline">{timeAgo(issue.updated_at)}</span>
    </div>
  );
}

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

  const [activeTab, setActiveTab] = useState<Tab>('assigned');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(FOCUS_SECTIONS.filter((s) => s.collapsedByDefault).map((s) => s.key)),
  );

  // Fetch my issues (assigned)
  const { data: myIssues = [], isLoading: loadingMine } = useQuery({
    queryKey: ['my-issues', user?.id],
    queryFn: () => apiClient.issues.listMine(user!.id),
    enabled: !!user?.id,
  });

  // Fetch all issues (for created/activity tabs)
  const { data: allIssues = [], isLoading: loadingAll } = useQuery({
    queryKey: ['all-issues'],
    queryFn: () => apiClient.issues.listAll({ limit: 2000 }),
    enabled: activeTab !== 'assigned',
    staleTime: 60_000,
  });

  const isLoading = activeTab === 'assigned' ? loadingMine : loadingAll;

  // Created tab: issues created by current user
  const createdIssues = useMemo(() => {
    if (!user?.id) return [];
    return allIssues
      .filter((i) => i.created_by_id === user.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [allIssues, user?.id]);

  // Activity tab: my assigned issues sorted by updated_at
  const activityIssues = useMemo(() => {
    return [...myIssues].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, [myIssues]);

  // Focus sections for assigned tab
  const focusSections = useMemo(() => {
    return FOCUS_SECTIONS.map((section) => ({
      ...section,
      issues: myIssues.filter(section.filter),
    })).filter((s) => s.issues.length > 0);
  }, [myIssues]);

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Deep link
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

  const selectedIssue = myIssues.find((i) => i.id === selectedIssueId);

  const currentIssues = activeTab === 'assigned' ? myIssues : activeTab === 'created' ? createdIssues : activityIssues;

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

      {/* Tabs */}
      <div className="flex items-center gap-0 border-b border-border px-3 md:px-6">
        {(['assigned', 'created', 'activity'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px capitalize',
              activeTab === tab
                ? 'border-accent text-accent'
                : 'border-transparent text-secondary hover:text-primary',
            )}
          >
            {tab === 'assigned' ? 'Assigned' : tab === 'created' ? 'Created' : 'Activity'}
            <span className="ml-1.5 rounded-full bg-surface-hover px-1.5 py-0.5 text-[9px] font-mono text-muted">
              {tab === 'assigned' ? myIssues.length : tab === 'created' ? createdIssues.length : activityIssues.length}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 md:p-6">
        {currentIssues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox size={40} className="text-border mb-3" />
            <p className="text-sm text-secondary">{t('myTasks.noTasks')}</p>
            <p className="text-xs text-muted mt-1">{t('myTasks.noTasksDesc')}</p>
          </div>
        ) : activeTab === 'assigned' ? (
          /* Focus grouping for Assigned tab */
          <div className="space-y-4">
            {focusSections.map((section) => {
              const isCollapsed = collapsedSections.has(section.key);
              return (
                <div key={section.key}>
                  <button
                    onClick={() => toggleSection(section.key)}
                    className="flex w-full items-center gap-2 mb-2 text-sm font-medium text-secondary hover:text-primary transition-colors"
                  >
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <span>{section.icon}</span>
                    <span>{section.label}</span>
                    <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-muted font-mono">
                      {section.issues.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="rounded-lg border border-border bg-surface overflow-hidden">
                      {section.issues.map((issue) => (
                        <IssueRow key={issue.id} issue={issue} onClick={() => openDetail(issue.id)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Flat list for Created/Activity tabs */
          <div className="rounded-lg border border-border bg-surface overflow-hidden">
            {currentIssues.map((issue) => (
              <IssueRow key={issue.id} issue={issue} onClick={() => openDetail(issue.id)} />
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
