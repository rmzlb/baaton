import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Flag,
  Inbox,
  PauseCircle,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────

interface OrgOverviewData {
  hero?: {
    open?: number;
    in_progress?: number;
    closed_period?: number;
    sla_breached?: number;
    period_days?: number;
  };
  action_items?: {
    blocked?: number;
    triage_backlog?: number;
    stale?: number;
    overdue_milestones?: number;
  };
  active_sprints?: Array<{
    sprint_id: string;
    name: string;
    project_prefix: string;
    project_name: string;
    start_date?: string | null;
    end_date?: string | null;
    planned: number;
    completed: number;
    pct: number;
  }>;
  upcoming_milestones?: Array<{
    milestone_id: string;
    name: string;
    project_prefix: string;
    project_name: string;
    target_date?: string | null;
    days_until: number;
  }>;
  projects?: Array<{
    project_id: string;
    name: string;
    prefix: string;
    total: number;
    open: number;
    in_progress: number;
    done: number;
    velocity_14d: number;
    bug_ratio: number;
    completion: number;
    stale_open: number;
  }>;
  top_contributors?: Array<{
    assignee_id: string;
    done_count: number;
  }>;
  activity_sparkline?: Array<{
    day: string;
    closed: number;
  }>;
}

interface OrgOverviewCardProps {
  data: OrgOverviewData;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function initialsOf(name: string): string {
  return name
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

// ─── Hero KPI tile (flat, no individual borders) ──────────────────────────

function HeroStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'amber' | 'red' | 'emerald' | 'blue';
}) {
  const valueColor = {
    neutral: 'text-[--color-primary]',
    blue: 'text-blue-300',
    amber: 'text-amber-300',
    red: 'text-red-300',
    emerald: 'text-emerald-300',
  }[tone];

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted] truncate">
        {label}
      </span>
      <span className={cn('text-2xl font-semibold leading-none tabular-nums', valueColor)}>
        {value}
      </span>
    </div>
  );
}

// ─── Action chip ──────────────────────────────────────────────────────────

function ActionChip({
  icon: Icon,
  label,
  count,
  tone,
  href,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  count: number;
  tone: 'red' | 'amber' | 'blue';
  href?: string;
}) {
  if (count === 0) return null;
  const toneClass = {
    red: 'bg-red-500/10 hover:bg-red-500/15 text-red-300',
    amber: 'bg-amber-500/10 hover:bg-amber-500/15 text-amber-300',
    blue: 'bg-blue-500/10 hover:bg-blue-500/15 text-blue-300',
  }[tone];
  const iconColor = {
    red: 'text-red-400',
    amber: 'text-amber-400',
    blue: 'text-blue-400',
  }[tone];

  const inner = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap',
        toneClass,
      )}
    >
      <Icon size={11} className={iconColor} />
      <span className="text-[--color-primary] tabular-nums">{count}</span>
      <span className="opacity-80">{label}</span>
    </span>
  );

  return href ? <Link to={href}>{inner}</Link> : inner;
}

// ─── Sprint row ───────────────────────────────────────────────────────────

function SprintRow({ s }: { s: NonNullable<OrgOverviewData['active_sprints']>[number] }) {
  const trendColor =
    s.pct >= 60 ? 'bg-emerald-400' : s.pct >= 30 ? 'bg-amber-400' : 'bg-red-400';

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[--color-surface-hover] transition-colors min-w-0">
      <span className="font-mono text-[10px] font-bold text-amber-400 shrink-0">
        {s.project_prefix}
      </span>
      <span className="text-[12px] text-[--color-primary] truncate flex-1 min-w-0">{s.name}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="h-1 w-12 rounded-full bg-[--color-border] overflow-hidden">
          <div
            className={cn('h-full transition-all', trendColor)}
            style={{ width: `${Math.min(100, s.pct)}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-[--color-muted] w-12 text-right">
          {s.completed}/{s.planned}
        </span>
      </div>
    </div>
  );
}

// ─── Milestone row ────────────────────────────────────────────────────────

function MilestoneRow({
  m,
  daysLabel,
}: {
  m: NonNullable<OrgOverviewData['upcoming_milestones']>[number];
  daysLabel: string;
}) {
  const urgent = m.days_until <= 3;
  const soon = m.days_until <= 7;
  const dotColor = urgent ? 'bg-red-400' : soon ? 'bg-amber-400' : 'bg-emerald-400';

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[--color-surface-hover] transition-colors min-w-0">
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotColor)} aria-hidden="true" />
      <span className="font-mono text-[10px] font-bold text-amber-400 shrink-0">
        {m.project_prefix}
      </span>
      <span className="text-[12px] text-[--color-primary] truncate flex-1 min-w-0">{m.name}</span>
      <span
        className={cn(
          'text-[10px] tabular-nums shrink-0',
          urgent ? 'text-red-300' : soon ? 'text-amber-300' : 'text-[--color-muted]',
        )}
      >
        {daysLabel}
      </span>
    </div>
  );
}

// ─── Project rollup row (with NAME visible, not just prefix) ──────────────

function ProjectRow({
  p,
}: {
  p: NonNullable<OrgOverviewData['projects']>[number];
}) {
  const completionPct = Math.round(p.completion * 100);
  const bugPct = Math.round(p.bug_ratio * 100);

  return (
    <Link
      to={`/all-issues?project=${encodeURIComponent(p.prefix)}`}
      className="grid grid-cols-[60px_1fr_auto_auto] sm:grid-cols-[60px_1fr_44px_44px_92px_44px_44px] items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[--color-surface-hover] transition-colors text-[12px]"
    >
      <span className="font-mono text-[10px] font-bold text-amber-400 truncate">{p.prefix}</span>
      <span className="text-[--color-primary] truncate min-w-0">{p.name}</span>
      <span className="hidden sm:inline tabular-nums text-blue-300 text-right">{p.open}</span>
      <span className="tabular-nums text-amber-300 text-right">{p.in_progress}</span>
      <div className="flex items-center gap-1.5 justify-end">
        <div className="h-1 w-10 sm:w-12 rounded-full bg-[--color-border] overflow-hidden">
          <div
            className="h-full bg-emerald-400 transition-all"
            style={{ width: `${completionPct}%` }}
          />
        </div>
        <span className="tabular-nums text-emerald-300 text-[10px] w-7 text-right">
          {completionPct}%
        </span>
      </div>
      <span className="hidden sm:inline tabular-nums text-[--color-muted] text-right">
        {p.velocity_14d}
      </span>
      <span
        className={cn(
          'hidden sm:inline tabular-nums text-right text-[11px]',
          bugPct > 30 ? 'text-red-300' : bugPct > 15 ? 'text-amber-300' : 'text-[--color-muted]',
        )}
      >
        {bugPct}%
      </span>
    </Link>
  );
}

// ─── Sparkline (with empty-state) ─────────────────────────────────────────

function Sparkline({
  points,
  total,
  emptyLabel,
  totalLabel,
}: {
  points: NonNullable<OrgOverviewData['activity_sparkline']>;
  total: number;
  emptyLabel: string;
  totalLabel: string;
}) {
  // Show a friendly empty state when fewer than 3 days have any activity.
  // Avoids the "broken" look of a sparkline with 1-2 lonely bars.
  const activeDays = points.filter((p) => p.closed > 0).length;
  if (activeDays < 3) {
    return (
      <span className="text-[11px] text-[--color-muted] italic">{emptyLabel}</span>
    );
  }

  const max = Math.max(1, ...points.map((p) => p.closed));

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-[2px] h-7">
        {points.map((p, i) => {
          const h = Math.max(2, (p.closed / max) * 24);
          return (
            <div
              key={i}
              className={cn(
                'flex-1 rounded-sm transition-colors',
                p.closed > 0 ? 'bg-amber-500/70 hover:bg-amber-400' : 'bg-[--color-border]',
              )}
              style={{ height: `${h}px` }}
              title={`${p.day}: ${p.closed}`}
            />
          );
        })}
      </div>
      <span className="text-[10px] tabular-nums text-[--color-muted]">
        {totalLabel.replace('{count}', String(total))}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export default function OrgOverviewCard({ data }: OrgOverviewCardProps) {
  const { t } = useTranslation();
  const hero = data.hero ?? {};
  const actions = data.action_items ?? {};
  const sprints = data.active_sprints ?? [];
  const milestones = data.upcoming_milestones ?? [];
  const projects = data.projects ?? [];
  const contributors = data.top_contributors ?? [];
  const activity = data.activity_sparkline ?? [];

  const periodDays = hero.period_days ?? 7;
  const slaBreached = hero.sla_breached ?? 0;
  const inProgressCount = hero.in_progress ?? 0;

  // Collapse project table to 6 rows when >6 projects to keep the card scannable.
  const [projectsExpanded, setProjectsExpanded] = useState(projects.length <= 6);
  const visibleProjects = useMemo(
    () => (projectsExpanded ? projects : projects.slice(0, 6)),
    [projects, projectsExpanded],
  );

  const hasActions =
    (actions.blocked ?? 0) +
      (actions.triage_backlog ?? 0) +
      (actions.stale ?? 0) +
      (actions.overdue_milestones ?? 0) >
    0;

  const totalClosedActivity = activity.reduce((acc, p) => acc + p.closed, 0);

  // Localized "in N days" string for milestones
  const dayLabel = (days: number) =>
    days === 0
      ? t('aiChat.overview.dayInTime.today', { defaultValue: 'today' })
      : days === 1
        ? t('aiChat.overview.dayInTime.tomorrow', { defaultValue: 'tomorrow' })
        : t('aiChat.overview.dayInTime.inDays', {
            days,
            defaultValue: `in ${days}d`,
          });

  return (
    // ── Single-surface card. NO nested borders — only horizontal dividers ──
    <div className="rounded-xl border border-[--color-border] bg-[--color-surface] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles size={12} className="text-amber-400 shrink-0" />
          <span className="text-[12px] font-semibold text-[--color-primary] truncate">
            {t('aiChat.overview.title', { defaultValue: 'Overview' })}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[--color-muted] tabular-nums shrink-0">
          {t('aiChat.overview.projects', {
            count: projects.length,
            defaultValue: `${projects.length} projects`,
          })}{' '}
          · {periodDays}
          {t('aiChat.overview.dayInTime.dayShort', { defaultValue: 'd' })}
        </span>
      </div>

      <div className="border-t border-[--color-border]" />

      {/* Hero KPIs — flat, no individual borders, short labels that don't wrap */}
      <div className="grid grid-cols-4 gap-3 px-3.5 py-3">
        <HeroStat
          label={t('aiChat.overview.kpi.open', { defaultValue: 'Open' })}
          value={hero.open ?? 0}
          tone="blue"
        />
        <HeroStat
          label={t('aiChat.overview.kpi.active', { defaultValue: 'Active' })}
          value={inProgressCount}
          tone={inProgressCount > 0 ? 'amber' : 'neutral'}
        />
        <HeroStat
          label={t('aiChat.overview.kpi.closed', {
            days: periodDays,
            defaultValue: `Closed ${periodDays}d`,
          })}
          value={hero.closed_period ?? 0}
          tone="emerald"
        />
        <HeroStat
          label={t('aiChat.overview.kpi.sla', { defaultValue: 'SLA' })}
          value={slaBreached}
          tone={slaBreached > 0 ? 'red' : 'neutral'}
        />
      </div>

      {/* Action items — only renders when something needs attention */}
      {hasActions && (
        <>
          <div className="border-t border-[--color-border]" />
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted] mr-0.5">
              {t('aiChat.overview.action.title', { defaultValue: 'Needs attention' })}
            </span>
            <ActionChip
              icon={PauseCircle}
              label={t('aiChat.overview.action.blocked', { defaultValue: 'blocked' })}
              count={actions.blocked ?? 0}
              tone="red"
              href="/all-issues?priority=urgent"
            />
            <ActionChip
              icon={Inbox}
              label={t('aiChat.overview.action.triage', { defaultValue: 'to triage' })}
              count={actions.triage_backlog ?? 0}
              tone="amber"
              href="/triage"
            />
            <ActionChip
              icon={Timer}
              label={t('aiChat.overview.action.stale', { defaultValue: 'stale 7d+' })}
              count={actions.stale ?? 0}
              tone="amber"
            />
            <ActionChip
              icon={Flag}
              label={t('aiChat.overview.action.overdueMilestones', {
                defaultValue: 'overdue milestones',
              })}
              count={actions.overdue_milestones ?? 0}
              tone="red"
              href="/milestones"
            />
          </div>
        </>
      )}

      {/* Sprints + Milestones (2-col on desktop, stack on mobile) */}
      {(sprints.length > 0 || milestones.length > 0) && (
        <>
          <div className="border-t border-[--color-border]" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 px-2 py-2">
            {sprints.length > 0 && (
              <Section
                title={t('aiChat.overview.activeSprints', { defaultValue: 'Active sprints' })}
                icon={Target}
                count={sprints.length}
              >
                {sprints.slice(0, 5).map((s) => (
                  <SprintRow key={s.sprint_id} s={s} />
                ))}
              </Section>
            )}
            {milestones.length > 0 && (
              <Section
                title={t('aiChat.overview.upcomingMilestones', {
                  defaultValue: 'Milestones (14d)',
                })}
                icon={Flag}
                count={milestones.length}
              >
                {milestones.slice(0, 5).map((m) => (
                  <MilestoneRow key={m.milestone_id} m={m} daysLabel={dayLabel(m.days_until)} />
                ))}
              </Section>
            )}
          </div>
        </>
      )}

      {/* Per-project rollup */}
      {projects.length > 0 && (
        <>
          <div className="border-t border-[--color-border]" />
          <div className="px-2 pt-2 pb-1">
            <div className="grid grid-cols-[60px_1fr_auto_auto] sm:grid-cols-[60px_1fr_44px_44px_92px_44px_44px] items-center gap-2 px-2 py-1.5">
              <div className="flex items-center gap-1 col-span-2">
                <TrendingUp size={11} className="text-[--color-muted]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
                  {t('aiChat.overview.byProject', { defaultValue: 'By project' })}
                </span>
              </div>
              <span className="hidden sm:block text-[9px] uppercase tracking-wider text-[--color-muted] text-right">
                {t('aiChat.overview.col.open', { defaultValue: 'Open' })}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-[--color-muted] text-right">
                {t('aiChat.overview.col.wip', { defaultValue: 'WIP' })}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-[--color-muted] text-right">
                {t('aiChat.overview.col.done', { defaultValue: 'Done' })}
              </span>
              <span className="hidden sm:block text-[9px] uppercase tracking-wider text-[--color-muted] text-right">
                {t('aiChat.overview.col.velocity', { defaultValue: 'Vel' })}
              </span>
              <span className="hidden sm:block text-[9px] uppercase tracking-wider text-[--color-muted] text-right">
                {t('aiChat.overview.col.bug', { defaultValue: 'Bug' })}
              </span>
            </div>
            <div>
              {visibleProjects.map((p) => (
                <ProjectRow key={p.project_id} p={p} />
              ))}
            </div>
            {projects.length > 6 && (
              <button
                type="button"
                onClick={() => setProjectsExpanded((v) => !v)}
                className="w-full flex items-center justify-center gap-1 px-3 py-1.5 mt-1 text-[11px] text-[--color-muted] hover:text-[--color-primary] hover:bg-[--color-surface-hover] rounded-md transition-colors"
              >
                {projectsExpanded ? (
                  <>
                    <ChevronDown size={11} />
                    {t('aiChat.overview.collapse', { defaultValue: 'Collapse' })}
                  </>
                ) : (
                  <>
                    <ChevronRight size={11} />
                    {t('aiChat.overview.expandRest', {
                      count: projects.length - 6,
                      defaultValue: `Show ${projects.length - 6} more`,
                    })}
                  </>
                )}
              </button>
            )}
          </div>
        </>
      )}

      {/* Contributors + Sparkline */}
      {(contributors.length > 0 || activity.length > 0) && (
        <>
          <div className="border-t border-[--color-border]" />
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 px-3.5 py-2.5 items-end">
            {contributors.length > 0 && (
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Users size={11} className="text-[--color-muted]" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
                    {t('aiChat.overview.contributors', {
                      days: periodDays,
                      defaultValue: `Top contributors (${periodDays}d)`,
                    })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {contributors.map((c) => (
                    <span
                      key={c.assignee_id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[--color-surface-hover] px-2 py-1 text-[11px]"
                    >
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 text-[9px] font-semibold">
                        {initialsOf(c.assignee_id) || '?'}
                      </span>
                      <span className="text-[--color-secondary] truncate max-w-[120px]">
                        {c.assignee_id.replace(/^@/, '')}
                      </span>
                      <span className="tabular-nums font-semibold text-emerald-300">
                        {c.done_count}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {activity.length > 0 && (
              <div className="md:w-44 min-w-0 space-y-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
                  {t('aiChat.overview.activity', { defaultValue: 'Activity 14d' })}
                </span>
                <Sparkline
                  points={activity}
                  total={totalClosedActivity}
                  emptyLabel={t('aiChat.overview.activityCalm', {
                    defaultValue: 'Quiet period',
                  })}
                  totalLabel={t('aiChat.overview.activityClosed', {
                    defaultValue: '{count} closed',
                  })}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Section wrapper (NO outer border, just a column with a label) ────────

function Section({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="px-1.5 py-1">
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-1.5">
          <Icon size={11} className="text-[--color-muted]" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
            {title}
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-[--color-muted]">{count}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}
