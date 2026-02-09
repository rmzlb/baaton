import { useOrganization } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { Kanban, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { GlobalCreateIssueButton } from '@/components/issues/GlobalCreateIssue';
import { ActivityFeed } from '@/components/activity/ActivityFeed';

export function Dashboard() {
  const { t } = useTranslation();
  const { organization } = useOrganization();
  const apiClient = useApi();

  // Fetch projects
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
  });

  // Fetch issues for all projects
  const { data: allIssues = [], isLoading: issuesLoading } = useQuery({
    queryKey: ['all-issues', projects.map(p => p.id)],
    queryFn: async () => {
      if (projects.length === 0) return [];
      const results = await Promise.all(
        projects.map(p => apiClient.issues.listByProject(p.id))
      );
      return results.flat();
    },
    enabled: projects.length > 0,
  });

  const isLoading = projectsLoading || issuesLoading;

  // Compute stats
  const openIssues = allIssues.filter(i => ['todo', 'backlog'].includes(i.status));
  const inProgress = allIssues.filter(i => i.status === 'in_progress');
  const inReview = allIssues.filter(i => i.status === 'in_review');

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const doneThisWeek = allIssues.filter(
    i => i.status === 'done' && new Date(i.updated_at) >= oneWeekAgo
  );

  const stats = [
    { label: t('dashboard.openIssues'), value: openIssues.length, color: '#3b82f6' },
    { label: t('dashboard.inProgress'), value: inProgress.length, color: '#f59e0b' },
    { label: t('dashboard.inReview'), value: inReview.length, color: '#8b5cf6' },
    { label: t('dashboard.doneThisWeek'), value: doneThisWeek.length, color: '#22c55e' },
  ];

  return (
    <div className="p-4 md:p-6">
      <div className="mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-primary">
          {organization?.name || t('dashboard.title')}
        </h1>
        <p className="mt-1 text-sm text-secondary">
          {t('dashboard.overview')}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-surface p-4 md:p-5"
          >
            <p className="text-[10px] md:text-xs text-secondary uppercase tracking-wider">
              {stat.label}
            </p>
            <p className="mt-2 text-2xl md:text-3xl font-bold" style={{ color: stat.color }}>
              {isLoading ? '—' : stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* New Issue CTA */}
      <div className="mt-6">
        <GlobalCreateIssueButton variant="big" />
      </div>

      {/* Projects + Recent Activity */}
      <div className="mt-6 md:mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Projects */}
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
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
            <div className="flex items-center justify-center py-12 text-sm text-secondary">
              {t('dashboard.loadingProjects')}
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Kanban size={32} className="text-secondary mb-2" />
              <p className="text-sm text-secondary">{t('dashboard.noProjects')}</p>
              <Link
                to="/projects"
                className="mt-2 text-xs text-accent hover:underline"
              >
                {t('dashboard.createFirst')}
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.slice(0, 5).map((project) => {
                const projectIssues = allIssues.filter(i => i.project_id === project.id);
                return (
                  <Link
                    key={project.id}
                    to={`/projects/${project.slug}`}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-surface-hover transition-colors group min-h-[44px]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover text-xs font-bold font-mono text-accent group-hover:bg-border">
                        {project.prefix}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-primary">{project.name}</p>
                        <p className="text-xs text-secondary">
                          {projectIssues.length} {projectIssues.length !== 1 ? t('dashboard.issues') : t('dashboard.issue')}
                        </p>
                      </div>
                    </div>
                    <ArrowRight size={14} className="text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Activity — real activity log */}
        <div className="rounded-xl border border-border bg-surface p-4 md:p-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-4">
            {t('dashboard.recentActivity')}
          </h2>
          <ActivityFeed limit={15} />
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
