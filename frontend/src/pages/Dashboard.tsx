import { useOrganization } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Kanban, ArrowRight, Archive, Clock, Circle,
  Eye, CheckCircle2, XCircle, AlertTriangle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { GlobalCreateIssueButton } from '@/components/issues/GlobalCreateIssue';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';
import type { Issue } from '@/lib/types';

// ─── Status config ─────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Circle }> = {
  backlog: { label: 'Backlog', color: '#6b7280', icon: Archive },
  todo: { label: 'Todo', color: '#3b82f6', icon: Circle },
  in_progress: { label: 'In Progress', color: '#f59e0b', icon: Clock },
  in_review: { label: 'In Review', color: '#8b5cf6', icon: Eye },
  done: { label: 'Done', color: '#22c55e', icon: CheckCircle2 },
  cancelled: { label: 'Cancelled', color: '#ef4444', icon: XCircle },
};

// ─── Progress bar component ────────────────────
function StatusBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (total === 0) return <div className="h-1.5 rounded-full bg-surface-hover" />;

  const segments = ['done', 'in_review', 'in_progress', 'todo', 'backlog']
    .filter((s) => (counts[s] || 0) > 0)
    .map((s) => ({
      key: s,
      width: ((counts[s] || 0) / total) * 100,
      color: STATUS_CONFIG[s]?.color || '#6b7280',
    }));

  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-hover">
      {segments.map((seg) => (
        <div
          key={seg.key}
          className="h-full transition-all duration-300"
          style={{ width: `${seg.width}%`, backgroundColor: seg.color }}
        />
      ))}
    </div>
  );
}

// ─── Project card ──────────────────────────────
function ProjectCard({
  project,
  issues,
}: {
  project: { id: string; name: string; slug: string; prefix: string };
  issues: Issue[];
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of issues) {
      c[i.status] = (c[i.status] || 0) + 1;
    }
    return c;
  }, [issues]);

  const backlog = counts['backlog'] || 0;
  const todo = counts['todo'] || 0;
  const inProgress = counts['in_progress'] || 0;
  const inReview = counts['in_review'] || 0;
  const done = counts['done'] || 0;
  const cancelled = counts['cancelled'] || 0;
  const total = issues.length;
  const active = backlog + todo + inProgress + inReview; // non-resolved
  const urgent = issues.filter((i) => i.priority === 'urgent' || i.priority === 'high').length;

  return (
    <Link
      to={`/projects/${project.slug}`}
      className="group rounded-xl border border-border bg-surface p-4 hover:border-accent/30 hover:shadow-md transition-all"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-[11px] font-bold font-mono text-accent">
            {project.prefix}
          </div>
          <div>
            <p className="text-sm font-semibold text-primary group-hover:text-accent transition-colors">
              {project.name}
            </p>
            <p className="text-[10px] text-muted font-mono uppercase tracking-wider">
              {total} issues
            </p>
          </div>
        </div>
        <ArrowRight size={14} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Status bar */}
      <StatusBar counts={counts} total={total} />

      {/* Status breakdown — focus on backlog + in progress */}
      <div className="grid grid-cols-4 gap-2 mt-3">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1">
            <Archive size={10} className="text-gray-400" />
            <span className="text-sm font-bold text-secondary tabular-nums">{backlog}</span>
          </div>
          <p className="text-[9px] text-muted uppercase tracking-wider mt-0.5">Backlog</p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1">
            <Circle size={10} style={{ color: '#3b82f6' }} />
            <span className="text-sm font-bold text-secondary tabular-nums">{todo}</span>
          </div>
          <p className="text-[9px] text-muted uppercase tracking-wider mt-0.5">Todo</p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1">
            <Clock size={10} style={{ color: '#f59e0b' }} />
            <span className="text-sm font-bold text-primary tabular-nums">{inProgress}</span>
          </div>
          <p className="text-[9px] text-muted uppercase tracking-wider mt-0.5">In Progress</p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1">
            <Eye size={10} style={{ color: '#8b5cf6' }} />
            <span className="text-sm font-bold text-secondary tabular-nums">{inReview}</span>
          </div>
          <p className="text-[9px] text-muted uppercase tracking-wider mt-0.5">Review</p>
        </div>
      </div>

      {/* Footer: active count + urgent badge */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/50">
        <span className="text-[11px] text-secondary">
          <span className="font-semibold text-primary">{active}</span> active · <span className="text-emerald-500">{done}</span> done
        </span>
        {urgent > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-500">
            <AlertTriangle size={10} />
            {urgent} urgent
          </span>
        )}
      </div>
    </Link>
  );
}

// ═══════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════
export function Dashboard() {
  const { t } = useTranslation();
  const { organization } = useOrganization();
  const apiClient = useApi();

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
  });

  const { data: allIssues = [], isLoading: issuesLoading } = useQuery({
    queryKey: ['all-issues', projects.map((p) => p.id)],
    queryFn: async () => {
      if (projects.length === 0) return [];
      const results = await Promise.all(
        projects.map((p) => apiClient.issues.listByProject(p.id, { limit: 500 })),
      );
      return results.flat();
    },
    enabled: projects.length > 0,
  });

  const isLoading = projectsLoading || issuesLoading;

  // Global stats
  const globalStats = useMemo(() => {
    const backlog = allIssues.filter((i) => i.status === 'backlog').length;
    const todo = allIssues.filter((i) => i.status === 'todo').length;
    const inProgress = allIssues.filter((i) => i.status === 'in_progress').length;
    const inReview = allIssues.filter((i) => i.status === 'in_review').length;
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const doneThisWeek = allIssues.filter(
      (i) => i.status === 'done' && new Date(i.updated_at) >= oneWeekAgo,
    ).length;
    const active = backlog + todo + inProgress + inReview;

    return [
      { label: t('dashboard.openIssues'), value: active, color: '#3b82f6' },
      { label: t('dashboard.inProgress'), value: inProgress, color: '#f59e0b' },
      { label: t('dashboard.inReview'), value: inReview, color: '#8b5cf6' },
      { label: t('dashboard.doneThisWeek'), value: doneThisWeek, color: '#22c55e' },
    ];
  }, [allIssues, t]);

  // Issues grouped by project
  const issuesByProject = useMemo(() => {
    const map: Record<string, Issue[]> = {};
    for (const i of allIssues) {
      if (!map[i.project_id]) map[i.project_id] = [];
      map[i.project_id].push(i);
    }
    return map;
  }, [allIssues]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-primary">
          {organization?.name || t('dashboard.title')}
        </h1>
        <p className="mt-1 text-sm text-secondary">{t('dashboard.overview')}</p>
      </div>

      {/* Global Stats */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {globalStats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-surface p-4 md:p-5">
            <p className="text-[10px] md:text-xs text-secondary uppercase tracking-wider">
              {stat.label}
            </p>
            <p className="mt-2 text-2xl md:text-3xl font-bold tabular-nums" style={{ color: stat.color }}>
              {isLoading ? '—' : stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* New Issue CTA */}
      <div className="mt-6">
        <GlobalCreateIssueButton variant="big" />
      </div>

      {/* Projects + Activity */}
      <div className="mt-6 md:mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Projects — 2 columns on large screens */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">
              {t('dashboard.projects')}
            </h2>
            <Link
              to="/projects"
              className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors"
            >
              {t('dashboard.viewAll')} <ArrowRight size={12} />
            </Link>
          </div>

          {projectsLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-secondary rounded-xl border border-border bg-surface">
              {t('dashboard.loadingProjects')}
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-border bg-surface">
              <Kanban size={32} className="text-secondary mb-2" />
              <p className="text-sm text-secondary">{t('dashboard.noProjects')}</p>
              <Link to="/projects" className="mt-2 text-xs text-accent hover:underline">
                {t('dashboard.createFirst')}
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  issues={issuesByProject[project.id] || []}
                />
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-4">
            {t('dashboard.recentActivity')}
          </h2>
          <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
            <ActivityFeed limit={15} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
