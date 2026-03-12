import { useAuth } from '@clerk/clerk-react';
import { useOrganizationList, useOrganization } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import {
  Kanban, ArrowRight, Archive, Clock, Circle,
  Eye, CheckCircle2, OctagonAlert, Building2, ChevronRight,
  TrendingUp, TrendingDown, Zap, Timer,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { GlobalCreateIssueButton } from '@/components/issues/GlobalCreateIssue';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { GamificationWidget } from '@/components/gamification/GamificationWidget';
import { cn } from '@/lib/utils';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import type { Issue, Project } from '@/lib/types';

// ─── SVG Activity Chart ────────────────────────────────

interface ChartPoint {
  date: string;
  count: number;
}

function ActivityChart({
  created,
  closed,
  days = 30,
}: {
  created: ChartPoint[];
  closed: ChartPoint[];
  days?: number;
}) {
  const width = 600;
  const height = 120;
  const padX = 10;
  const padY = 10;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  // Build date range
  const dateRange: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dateRange.push(d.toISOString().slice(0, 10));
  }

  const createdMap = Object.fromEntries(created.map((p) => [p.date, p.count]));
  const closedMap = Object.fromEntries(closed.map((p) => [p.date, p.count]));

  const createdData = dateRange.map((d) => createdMap[d] ?? 0);
  const closedData = dateRange.map((d) => closedMap[d] ?? 0);

  const maxVal = Math.max(...createdData, ...closedData, 1);

  const toX = (i: number) => padX + (i / (dateRange.length - 1)) * plotW;
  const toY = (v: number) => padY + plotH - (v / maxVal) * plotH;

  const pathFor = (data: number[]) =>
    data
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
      .join(' ');

  const areaFor = (data: number[], color: string) => {
    const line = pathFor(data);
    const bottomLeft = `L${toX(data.length - 1).toFixed(1)},${(padY + plotH).toFixed(1)} L${padX},${(padY + plotH).toFixed(1)} Z`;
    return (
      <path
        d={`${line} ${bottomLeft}`}
        fill={color}
        fillOpacity="0.08"
        stroke="none"
      />
    );
  };

  return (
    <div className="w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height: '120px' }}
        aria-label="Issue activity chart"
      >
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map((pct) => (
          <line
            key={pct}
            x1={padX}
            y1={padY + plotH * (1 - pct)}
            x2={width - padX}
            y2={padY + plotH * (1 - pct)}
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="1"
          />
        ))}
        {/* Area fills */}
        {areaFor(createdData, '#f59e0b')}
        {areaFor(closedData, '#22c55e')}
        {/* Lines */}
        <path d={pathFor(createdData)} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={pathFor(closedData)} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <div className="flex items-center gap-4 mt-1">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-amber-500 rounded-full inline-block" />
          <span className="text-[11px] text-secondary">Created</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-green-500 rounded-full inline-block" />
          <span className="text-[11px] text-secondary">Closed</span>
        </div>
      </div>
    </div>
  );
}

// ─── Stats card ────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
  icon: Icon,
  sub,
}: {
  label: string;
  value: number | string;
  color: string;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 md:p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] md:text-xs text-secondary uppercase tracking-wider">{label}</p>
        <Icon size={14} style={{ color }} className="opacity-60" />
      </div>
      <p className="text-2xl md:text-3xl font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

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
  onNavigate,
}: {
  project: Project;
  issues: Issue[];
  onNavigate: () => void;
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

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(); } }}
      className="group rounded-xl border border-border bg-surface p-4 transition-all hover:border-accent/30 hover:shadow-md cursor-pointer"
    >
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
      <StatusBar counts={counts} total={total} />
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
    </div>
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
  onProjectNavigate,
}: {
  orgName: string;
  orgSlug: string;
  orgImageUrl?: string | null;
  projects: Project[];
  issuesByProject: Record<string, Issue[]>;
  isCurrentOrg: boolean;
  onSwitch?: () => void;
  onProjectNavigate: (project: Project) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useTranslation();
  const allIssues = projects.flatMap((p) => issuesByProject[p.id] || []);
  const totalActive = allIssues.filter((i) => !['done', 'cancelled'].includes(i.status)).length;
  const totalIssues = allIssues.length;

  return (
    <div className="mb-6">
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
                onNavigate={() => onProjectNavigate(p)}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Dashboard — main component
// ═══════════════════════════════════════════════
export function Dashboard() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const { organization: activeOrg } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const apiClient = useApi();

  const memberships = userMemberships?.data ?? [];

  // Fetch projects + issues for ALL orgs
  const { data: orgData = [], isLoading } = useQuery({
    queryKey: ['dashboard-cross-org', memberships.map((m) => m.organization.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        memberships.map(async (m) => {
          const org = m.organization;
          try {
            const token = await getToken({ organizationId: org.id });
            if (!token) return { org, projects: [] as Project[], issues: [] as Issue[] };
            const projects = await api.get<Project[]>('/projects', token);
            const issues = await api.get<Issue[]>('/issues?limit=2000', token);
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

  // Metrics (for active org)
  const { data: metrics } = useQuery({
    queryKey: ['metrics', activeOrg?.id],
    queryFn: () => apiClient.metrics.get(30),
    enabled: !!activeOrg,
    staleTime: 60_000,
  });

  // Build issues-by-project map
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

  // Global stats
  const allIssues = orgData.flatMap((d) => d.issues);
  const oneWeekAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  }, []);

  const statsCards = useMemo(() => {
    const active = allIssues.filter((i) => !['done', 'cancelled'].includes(i.status)).length;
    const createdThisWeek = allIssues.filter((i) => new Date(i.created_at) >= oneWeekAgo).length;
    const closedThisWeek = allIssues.filter(
      (i) => ['done', 'cancelled'].includes(i.status) && new Date(i.updated_at) >= oneWeekAgo,
    ).length;
    const avgResolutionHours = metrics?.avg_resolution_hours;
    const avgLabel = avgResolutionHours != null
      ? avgResolutionHours >= 24
        ? `${(avgResolutionHours / 24).toFixed(1)}d`
        : `${avgResolutionHours.toFixed(1)}h`
      : '—';

    return [
      { label: 'Active Issues', value: active, color: '#3b82f6', icon: TrendingUp, sub: 'Not done or cancelled' },
      { label: 'Created This Week', value: createdThisWeek, color: '#f59e0b', icon: Zap, sub: 'Last 7 days' },
      { label: 'Closed This Week', value: closedThisWeek, color: '#22c55e', icon: TrendingDown, sub: 'Done or cancelled' },
      { label: 'Avg Resolution', value: avgLabel, color: '#8b5cf6', icon: Timer, sub: 'Time to close' },
    ];
  }, [allIssues, oneWeekAgo, metrics]);

  // Cross-org navigation
  const pendingNavRef = useRef<string | null>(null);
  useEffect(() => {
    if (pendingNavRef.current && activeOrg) {
      const target = pendingNavRef.current;
      pendingNavRef.current = null;
      navigate(`/projects/${target}`);
    }
  }, [activeOrg, navigate]);

  const handleProjectNavigate = useCallback(
    (orgId: string, project: Project) => {
      if (orgId === activeOrg?.id) {
        navigate(`/projects/${project.slug}`);
      } else {
        pendingNavRef.current = project.slug;
        setActive?.({ organization: orgId });
      }
    },
    [activeOrg?.id, navigate, setActive],
  );

  const sortedOrgData = useMemo(() => {
    return [...orgData].sort((a, b) => {
      if (a.org.id === activeOrg?.id) return -1;
      if (b.org.id === activeOrg?.id) return 1;
      return a.org.name.localeCompare(b.org.name);
    });
  }, [orgData, activeOrg?.id]);

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-primary">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-secondary">
          {memberships.length > 1
            ? `${memberships.length} organizations · ${orgData.reduce((s, d) => s + d.projects.length, 0)} projects`
            : t('dashboard.overview')}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4 mb-6">
        {statsCards.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {/* Activity Chart */}
      {metrics && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-secondary uppercase tracking-wider">
              Activity — last 30 days
            </h2>
            <span className="text-[11px] text-muted">
              {metrics.issues_created?.reduce((s: number, p: any) => s + p.count, 0) ?? 0} created ·{' '}
              {metrics.issues_closed?.reduce((s: number, p: any) => s + p.count, 0) ?? 0} closed
            </span>
          </div>
          <ActivityChart
            created={metrics.issues_created ?? []}
            closed={metrics.issues_closed ?? []}
            days={30}
          />
        </div>
      )}

      <div className="mb-6">
        <GlobalCreateIssueButton variant="big" />
      </div>

      {/* Orgs + Projects + Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
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
            <div className="space-y-4">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[...Array(2)].map((_, j) => (
                    <div key={j} className="rounded-xl border border-border bg-surface p-4 space-y-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-lg bg-surface-hover animate-pulse" />
                        <div className="space-y-1.5 flex-1">
                          <div className="h-4 w-32 rounded bg-surface-hover animate-pulse" />
                          <div className="h-2.5 w-20 rounded bg-surface-hover animate-pulse" />
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-hover animate-pulse" />
                    </div>
                  ))}
                </div>
              ))}
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
                onProjectNavigate={(project) => handleProjectNavigate(org.id, project)}
              />
            ))
          )}
        </div>

        {/* Right column: Gamification + Activity Feed */}
        <div className="space-y-4">
          <GamificationWidget />

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
    </div>
  );
}

export default Dashboard;
