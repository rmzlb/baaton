import { useAuth } from '@clerk/clerk-react';
import { useOrganizationList, useOrganization } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { api } from '@/lib/api';
import {
  Kanban, ArrowRight, Archive, Clock, Circle,
  Eye, CheckCircle2, OctagonAlert, Building2, ChevronRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { GlobalCreateIssueButton } from '@/components/issues/GlobalCreateIssue';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import type { Issue, Project } from '@/lib/types';

// ─── Status bar ────────────────────────────────
function StatusBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (total === 0) return <div className="h-1.5 rounded-full bg-surface-hover" />;
  const segments = ['done', 'in_review', 'in_progress', 'todo', 'backlog']
    .filter((s) => (counts[s] || 0) > 0)
    .map((s) => ({
      key: s,
      width: ((counts[s] || 0) / total) * 100,
      color: { done: '#22c55e', in_review: '#8b5cf6', in_progress: '#f59e0b', todo: '#3b82f6', backlog: '#6b7280' }[s] || '#6b7280',
    }));

  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-hover">
      {segments.map((seg) => (
        <div key={seg.key} className="h-full transition-all duration-300" style={{ width: `${seg.width}%`, backgroundColor: seg.color }} />
      ))}
    </div>
  );
}

// ─── Project card ──────────────────────────────
function ProjectCard({
  project,
  issues,
  isCurrentOrg,
}: {
  project: Project;
  issues: Issue[];
  isCurrentOrg: boolean;
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of issues) c[i.status] = (c[i.status] || 0) + 1;
    return c;
  }, [issues]);

  const backlog = counts['backlog'] || 0;
  const todo = counts['todo'] || 0;
  const inProgress = counts['in_progress'] || 0;
  const inReview = counts['in_review'] || 0;
  const done = counts['done'] || 0;
  const total = issues.length;
  const active = backlog + todo + inProgress + inReview;
  const urgent = issues.filter((i) => (i.priority === 'urgent' || i.priority === 'high') && !['done', 'cancelled'].includes(i.status)).length;

  const Wrapper = isCurrentOrg ? Link : 'div';
  const wrapperProps = isCurrentOrg
    ? { to: `/projects/${project.slug}` }
    : {};

  return (
    <Wrapper
      {...(wrapperProps as any)}
      className={cn(
        'group rounded-xl border border-border bg-surface p-4 transition-all',
        isCurrentOrg && 'hover:border-accent/30 hover:shadow-md cursor-pointer',
        !isCurrentOrg && 'opacity-80',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-[11px] font-bold font-mono text-accent">
            {project.prefix}
          </div>
          <div>
            <p className={cn(
              'text-sm font-semibold text-primary',
              isCurrentOrg && 'group-hover:text-accent transition-colors',
            )}>
              {project.name}
            </p>
            <p className="text-[10px] text-muted font-mono uppercase tracking-wider">
              {total} issues
            </p>
          </div>
        </div>
        {isCurrentOrg && (
          <ArrowRight size={14} className="text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>

      {/* Status bar */}
      <StatusBar counts={counts} total={total} />

      {/* Status breakdown */}
      <div className="grid grid-cols-4 gap-2 mt-3">
        {[
          { key: 'backlog', label: 'Backlog', icon: Archive, color: undefined, value: backlog },
          { key: 'todo', label: 'Todo', icon: Circle, color: '#3b82f6', value: todo },
          { key: 'in_progress', label: 'In Progress', icon: Clock, color: '#f59e0b', value: inProgress },
          { key: 'in_review', label: 'Review', icon: Eye, color: '#8b5cf6', value: inReview },
        ].map((s) => (
          <div key={s.key} className="text-center">
            <div className="flex items-center justify-center gap-1">
              <s.icon size={10} style={s.color ? { color: s.color } : undefined} className={!s.color ? 'text-gray-400' : ''} />
              <span className={cn('text-sm font-bold tabular-nums', s.key === 'in_progress' ? 'text-primary' : 'text-secondary')}>
                {s.value}
              </span>
            </div>
            <p className="text-[9px] text-muted uppercase tracking-wider mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/50">
        <span className="text-[11px] text-secondary">
          <span className="font-semibold text-primary">{active}</span> active · <span className="text-emerald-500">{done}</span> done
        </span>
        {urgent > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold text-orange-500">
            <OctagonAlert size={10} />
            {urgent}
          </span>
        )}
      </div>
    </Wrapper>
  );
}

// ─── Org section ───────────────────────────────
function OrgSection({
  orgName,
  orgSlug,
  orgImageUrl,
  projects,
  issuesByProject,
  isCurrentOrg,
  onSwitch,
}: {
  orgName: string;
  orgSlug: string;
  orgImageUrl?: string | null;
  projects: Project[];
  issuesByProject: Record<string, Issue[]>;
  isCurrentOrg: boolean;
  onSwitch?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useTranslation();

  // Aggregate stats
  const allIssues = projects.flatMap((p) => issuesByProject[p.id] || []);
  const totalActive = allIssues.filter((i) => !['done', 'cancelled'].includes(i.status)).length;
  const totalIssues = allIssues.length;

  return (
    <div className="mb-6">
      {/* Org header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2.5 mb-3 group w-full text-left"
      >
        <ChevronRight
          size={14}
          className={cn('text-muted transition-transform', !collapsed && 'rotate-90')}
        />
        {orgImageUrl ? (
          <img src={orgImageUrl} alt="" className="h-6 w-6 rounded-md" />
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10">
            <Building2 size={12} className="text-accent" />
          </div>
        )}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold text-primary truncate">{orgName}</span>
          {isCurrentOrg && (
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-semibold text-accent uppercase tracking-wider">
              Active
            </span>
          )}
          <span className="text-[10px] text-muted font-mono shrink-0">
            {projects.length} proj · {totalActive} active / {totalIssues}
          </span>
        </div>
        <Link
          to={`/all-issues?org=${encodeURIComponent(orgSlug)}`}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-[10px] text-secondary hover:text-accent transition-colors"
        >
          All issues →
        </Link>
        {!isCurrentOrg && onSwitch && (
          <button
            onClick={(e) => { e.stopPropagation(); onSwitch(); }}
            className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-secondary hover:text-primary hover:border-accent transition-colors"
          >
            {t('dashboard.switchOrg') || 'Switch'}
          </button>
        )}
      </button>

      {/* Projects grid */}
      {!collapsed && (
        projects.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-surface/50 p-6 text-center text-sm text-muted">
            No projects yet
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                issues={issuesByProject[p.id] || []}
                isCurrentOrg={isCurrentOrg}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Dashboard — Cross-org view
// ═══════════════════════════════════════════════
export function Dashboard() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const { organization: activeOrg } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  const memberships = userMemberships?.data ?? [];

  // Fetch projects + issues for ALL orgs
  const { data: orgData = [], isLoading } = useQuery({
    queryKey: ['dashboard-cross-org', memberships.map((m) => m.organization.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        memberships.map(async (m) => {
          const org = m.organization;
          try {
            // Get token scoped to this specific org
            const token = await getToken({ organizationId: org.id });
            if (!token) return { org, projects: [] as Project[], issues: [] as Issue[] };

            const projects = await api.get<Project[]>('/projects', token);
            const issues = (
              await Promise.all(
                projects.map(async (p) => {
                  try { return await api.get<Issue[]>(`/projects/${p.id}/issues?limit=500`, token); }
                  catch { return [] as Issue[]; }
                }),
              )
            ).flat();

            return { org, projects, issues };
          } catch {
            return { org, projects: [] as Project[], issues: [] as Issue[] };
          }
        }),
      );
      return results;
    },
    enabled: memberships.length > 0,
    staleTime: 30_000,
  });

  // Build issues-by-project map across all orgs
  const issuesByProject = useMemo(() => {
    const map: Record<string, Issue[]> = {};
    for (const { issues } of orgData) {
      for (const i of issues) {
        if (!map[i.project_id]) map[i.project_id] = [];
        map[i.project_id].push(i);
      }
    }
    return map;
  }, [orgData]);

  // Global stats across ALL orgs
  const allIssues = orgData.flatMap((d) => d.issues);
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

  // Sort orgs: active first
  const sortedOrgData = useMemo(() => {
    return [...orgData].sort((a, b) => {
      if (a.org.id === activeOrg?.id) return -1;
      if (b.org.id === activeOrg?.id) return 1;
      return a.org.name.localeCompare(b.org.name);
    });
  }, [orgData, activeOrg?.id]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-primary">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-secondary">
          {memberships.length > 1
            ? `${memberships.length} organizations · ${orgData.reduce((s, d) => s + d.projects.length, 0)} projects`
            : t('dashboard.overview')}
        </p>
      </div>

      {/* Global Stats */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {globalStats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-surface p-4 md:p-5">
            <p className="text-[10px] md:text-xs text-secondary uppercase tracking-wider">{stat.label}</p>
            <p className="mt-2 text-2xl md:text-3xl font-bold tabular-nums" style={{ color: stat.color }}>
              {isLoading ? '—' : stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <GlobalCreateIssueButton variant="big" />
      </div>

      {/* Orgs + Projects + Activity */}
      <div className="mt-6 md:mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Projects by org — 2 columns */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">
              {t('dashboard.projects')}
            </h2>
            <div className="flex items-center gap-3">
              <Link to="/all-issues" className="flex items-center gap-1 text-xs text-secondary hover:text-accent transition-colors">
                {t('allIssues.title') || 'All issues'} <ArrowRight size={12} />
              </Link>
              <Link to="/projects" className="flex items-center gap-1 text-xs text-accent hover:text-accent-hover transition-colors">
                {t('dashboard.viewAll')} <ArrowRight size={12} />
              </Link>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-secondary rounded-xl border border-border bg-surface">
              {t('dashboard.loadingProjects')}
            </div>
          ) : sortedOrgData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-border bg-surface">
              <Kanban size={32} className="text-secondary mb-2" />
              <p className="text-sm text-secondary">{t('dashboard.noProjects')}</p>
            </div>
          ) : (
            sortedOrgData.map(({ org, projects }) => (
              <OrgSection
                key={org.id}
                orgName={org.name}
                orgSlug={org.slug}
                orgImageUrl={(org as any).imageUrl || (org as any).image_url}
                projects={projects}
                issuesByProject={issuesByProject}
                isCurrentOrg={org.id === activeOrg?.id}
                onSwitch={org.id !== activeOrg?.id ? () => setActive?.({ organization: org.id }) : undefined}
              />
            ))
          )}
        </div>

        {/* Activity */}
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
