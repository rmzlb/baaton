import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Flag,
  Inbox,
  PauseCircle,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  Users,
} from 'lucide-react';
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

function formatDate(s?: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return '—';
  }
}

// ─── Hero KPI tile ────────────────────────────────────────────────────────

function HeroStat({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number | string;
  tone?: 'neutral' | 'amber' | 'red' | 'emerald';
}) {
  const toneRing = {
    neutral: 'border-[--color-border]',
    amber: 'border-amber-500/30 bg-amber-500/[0.04]',
    red: 'border-red-500/40 bg-red-500/[0.06]',
    emerald: 'border-emerald-500/30 bg-emerald-500/[0.04]',
  }[tone];
  const toneIcon = {
    neutral: 'text-[--color-muted]',
    amber: 'text-amber-400',
    red: 'text-red-400',
    emerald: 'text-emerald-400',
  }[tone];
  const toneValue = {
    neutral: 'text-[--color-primary]',
    amber: 'text-amber-300',
    red: 'text-red-300',
    emerald: 'text-emerald-300',
  }[tone];

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border bg-[--color-surface] px-3 py-2.5 transition-colors',
        toneRing,
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={11} className={toneIcon} />
        <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
          {label}
        </span>
      </div>
      <span className={cn('text-2xl font-semibold leading-none tabular-nums', toneValue)}>
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
    red: 'border-red-500/40 bg-red-500/[0.08] text-red-300 hover:bg-red-500/[0.14]',
    amber: 'border-amber-500/40 bg-amber-500/[0.08] text-amber-300 hover:bg-amber-500/[0.14]',
    blue: 'border-blue-500/40 bg-blue-500/[0.08] text-blue-300 hover:bg-blue-500/[0.14]',
  }[tone];
  const iconColor = {
    red: 'text-red-400',
    amber: 'text-amber-400',
    blue: 'text-blue-400',
  }[tone];

  const inner = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        toneClass,
      )}
    >
      <Icon size={11} className={iconColor} />
      <span className="text-[--color-primary]">{count}</span>
      <span className="text-[--color-muted]">{label}</span>
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
        <span className="text-[10px] tabular-nums text-[--color-muted] w-16 text-right">
          {s.completed}/{s.planned}
        </span>
      </div>
    </div>
  );
}

// ─── Milestone row ────────────────────────────────────────────────────────

function MilestoneRow({
  m,
}: {
  m: NonNullable<OrgOverviewData['upcoming_milestones']>[number];
}) {
  const urgent = m.days_until <= 3;
  const soon = m.days_until <= 7;
  const dotColor = urgent ? 'bg-red-400' : soon ? 'bg-amber-400' : 'bg-emerald-400';
  const daysLabel =
    m.days_until === 0
      ? "aujourd'hui"
      : m.days_until === 1
        ? 'demain'
        : `dans ${m.days_until}j`;

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

// ─── Project rollup row ───────────────────────────────────────────────────

function ProjectRow({
  p,
}: {
  p: NonNullable<OrgOverviewData['projects']>[number];
}) {
  const completionPct = Math.round(p.completion * 100);
  const bugPct = Math.round(p.bug_ratio * 100);
  const hasStale = p.stale_open > 0;

  return (
    <Link
      to={`/all-issues?project=${encodeURIComponent(p.prefix)}`}
      className="grid grid-cols-[auto_1fr_auto_auto_auto] sm:grid-cols-[auto_1fr_60px_60px_80px_60px_60px] items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[--color-surface-hover] transition-colors text-[12px]"
    >
      <span className="font-mono text-[10px] font-bold text-amber-400 shrink-0 w-12">
        {p.prefix}
      </span>
      <span className="text-[--color-primary] truncate min-w-0">{p.name}</span>
      <span className="hidden sm:inline tabular-nums text-blue-300 text-right">{p.open}</span>
      <span className="tabular-nums text-amber-300 text-right">{p.in_progress}</span>
      <div className="flex items-center gap-1.5">
        <div className="h-1 w-10 sm:w-14 rounded-full bg-[--color-border] overflow-hidden">
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
        <span className="text-[10px]">/14d</span>
      </span>
      <span
        className={cn(
          'hidden sm:inline tabular-nums text-right text-[11px]',
          bugPct > 30 ? 'text-red-300' : bugPct > 15 ? 'text-amber-300' : 'text-[--color-muted]',
        )}
        title={hasStale ? `${p.stale_open} stale` : undefined}
      >
        {bugPct}%
      </span>
    </Link>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────

function Sparkline({
  points,
}: {
  points: NonNullable<OrgOverviewData['activity_sparkline']>;
}) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.closed));
  const total = points.reduce((acc, p) => acc + p.closed, 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
          Activité 14j
        </span>
        <span className="text-[10px] tabular-nums text-[--color-muted]">
          {total} closed
        </span>
      </div>
      <div className="flex items-end gap-[2px] h-8">
        {points.map((p, i) => {
          const h = Math.max(2, (p.closed / max) * 28);
          return (
            <div
              key={i}
              className="flex-1 bg-amber-500/60 rounded-sm transition-all hover:bg-amber-400"
              style={{ height: `${h}px` }}
              title={`${p.day}: ${p.closed}`}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export default function OrgOverviewCard({ data }: OrgOverviewCardProps) {
  const hero = data.hero ?? {};
  const actions = data.action_items ?? {};
  const sprints = data.active_sprints ?? [];
  const milestones = data.upcoming_milestones ?? [];
  const projects = data.projects ?? [];
  const contributors = data.top_contributors ?? [];
  const activity = data.activity_sparkline ?? [];

  const periodDays = hero.period_days ?? 7;
  const slaBreached = hero.sla_breached ?? 0;

  // Collapse project table by default when >6 projects to keep the card scannable.
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

  return (
    <div className="rounded-xl border border-[--color-border] bg-[--color-surface] overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[--color-border]">
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="text-amber-400" />
          <span className="text-[12px] font-semibold text-[--color-primary]">Vue d'ensemble</span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[--color-muted] tabular-nums">
          {projects.length} projet{projects.length > 1 ? 's' : ''} · {periodDays}j
        </span>
      </div>

      {/* ── Hero KPIs ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
        <HeroStat icon={Circle} label="Ouvertes" value={hero.open ?? 0} />
        <HeroStat
          icon={Clock}
          label="In progress"
          value={hero.in_progress ?? 0}
          tone={(hero.in_progress ?? 0) > 0 ? 'amber' : 'neutral'}
        />
        <HeroStat
          icon={CheckCircle2}
          label={`Closed ${periodDays}j`}
          value={hero.closed_period ?? 0}
          tone="emerald"
        />
        <HeroStat
          icon={AlertTriangle}
          label="SLA breached"
          value={slaBreached}
          tone={slaBreached > 0 ? 'red' : 'neutral'}
        />
      </div>

      {/* ── Action items (only if non-zero) ── */}
      {hasActions && (
        <div className="px-3 pb-3">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[--color-border] bg-[--color-bg] px-3 py-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted] mr-1">
              Action requise
            </span>
            <ActionChip
              icon={PauseCircle}
              label="bloquées"
              count={actions.blocked ?? 0}
              tone="red"
              href="/all-issues?priority=urgent"
            />
            <ActionChip
              icon={Inbox}
              label="à trier"
              count={actions.triage_backlog ?? 0}
              tone="amber"
              href="/triage"
            />
            <ActionChip
              icon={Timer}
              label="stale > 7j"
              count={actions.stale ?? 0}
              tone="amber"
            />
            <ActionChip
              icon={Flag}
              label="milestones en retard"
              count={actions.overdue_milestones ?? 0}
              tone="red"
              href="/milestones"
            />
          </div>
        </div>
      )}

      {/* ── Sprints + Milestones (2-col) ── */}
      {(sprints.length > 0 || milestones.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-3 pb-3">
          {sprints.length > 0 && (
            <Section title="Sprints actifs" icon={Target} count={sprints.length}>
              {sprints.slice(0, 5).map((s) => (
                <SprintRow key={s.sprint_id} s={s} />
              ))}
            </Section>
          )}
          {milestones.length > 0 && (
            <Section title="Milestones (14j)" icon={Flag} count={milestones.length}>
              {milestones.slice(0, 5).map((m) => (
                <MilestoneRow key={m.milestone_id} m={m} />
              ))}
            </Section>
          )}
        </div>
      )}

      {/* ── Per-project rollup ── */}
      {projects.length > 0 && (
        <div className="px-3 pb-3">
          <div className="rounded-lg border border-[--color-border] bg-[--color-bg]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[--color-border]">
              <div className="flex items-center gap-1.5">
                <TrendingUp size={11} className="text-[--color-muted]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
                  Par projet
                </span>
              </div>
              {/* Header columns (desktop only) */}
              <div className="hidden sm:grid grid-cols-[60px_60px_80px_60px_60px] gap-2 text-[9px] uppercase tracking-wider text-[--color-muted]">
                <span className="text-right">Open</span>
                <span className="text-right">WIP</span>
                <span className="text-right">Done %</span>
                <span className="text-right">Vel.</span>
                <span className="text-right">Bug %</span>
              </div>
            </div>
            <div className="py-1">
              {visibleProjects.map((p) => (
                <ProjectRow key={p.project_id} p={p} />
              ))}
            </div>
            {projects.length > 6 && (
              <button
                type="button"
                onClick={() => setProjectsExpanded((v) => !v)}
                className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-[11px] text-[--color-muted] hover:text-[--color-primary] hover:bg-[--color-surface-hover] transition-colors border-t border-[--color-border]"
              >
                {projectsExpanded ? (
                  <>
                    <ChevronDown size={11} />
                    Réduire
                  </>
                ) : (
                  <>
                    <ChevronRight size={11} />
                    Voir les {projects.length - 6} autres
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Contributors + Sparkline ── */}
      {(contributors.length > 0 || activity.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 px-3 pb-3 items-start">
          {contributors.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Users size={11} className="text-[--color-muted]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
                  Top contributeurs ({periodDays}j)
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {contributors.map((c) => (
                  <span
                    key={c.assignee_id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[--color-border] bg-[--color-bg] px-2 py-1 text-[11px]"
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
            <div className="md:w-48">
              <Sparkline points={activity} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────

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
    <div className="rounded-lg border border-[--color-border] bg-[--color-bg] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[--color-border]">
        <div className="flex items-center gap-1.5">
          <Icon size={11} className="text-[--color-muted]" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
            {title}
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-[--color-muted]">{count}</span>
      </div>
      <div className="py-1 px-1">{children}</div>
    </div>
  );
}
