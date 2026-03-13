import { useAuth } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import {
  Flame, TrendingUp, TrendingDown, Minus, Zap, Bot, User,
  Target, ArrowRight, Circle, CheckCircle2, Clock, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HeatmapCell } from '@/lib/types';

// ─── Types ────────────────────────────────────────────

interface DashboardData {
  personal: {
    velocity_7d: number; velocity_30d: number; velocity_trend: string;
    this_week: number; today: number;
    streak: number; longest_streak: number; best_day: number; best_week: number;
    goal: number | null;
    breakdown: Breakdown;
    heatmap: HeatmapCell[];
  };
  org: {
    velocity_7d: number; this_week: number; today: number;
    breakdown: Breakdown;
    heatmap: HeatmapCell[];
  };
  projects: Array<{ id: string; name: string; prefix: string; actions_30d: number }>;
  contributors: Array<{ user_id: string; name: string; actions: number; is_agent: boolean }>;
  assigned: Array<{
    id: string; display_id: string; title: string;
    status: string; priority: string | null;
    project_prefix: string; project_name: string;
  }>;
}

interface Breakdown {
  issues_created: number; issues_closed: number; comments: number;
  tldrs: number; status_changes: number; updates: number; github: number;
}

// ─── Colors ───────────────────────────────────────────

const PROJECT_COLORS = [
  'bg-amber-500', 'bg-emerald-500', 'bg-blue-500', 'bg-purple-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-teal-500',
];

const PROJECT_DOT_COLORS = [
  'text-amber-500', 'text-emerald-500', 'text-blue-500', 'text-purple-500',
  'text-rose-500', 'text-cyan-500', 'text-orange-500', 'text-teal-500',
];

const PRIORITY_CONFIG: Record<string, { color: string; icon: typeof AlertTriangle; label: string }> = {
  urgent: { color: 'text-red-500', icon: AlertTriangle, label: 'Urgent' },
  high:   { color: 'text-orange-500', icon: ArrowRight, label: 'High' },
  medium: { color: 'text-amber-500', icon: Minus, label: 'Medium' },
  low:    { color: 'text-blue-400', icon: Minus, label: 'Low' },
};

const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  backlog:     { color: 'text-gray-400', bg: 'bg-gray-400/10' },
  todo:        { color: 'text-blue-400', bg: 'bg-blue-400/10' },
  in_progress: { color: 'text-amber-400', bg: 'bg-amber-400/10' },
  in_review:   { color: 'text-purple-400', bg: 'bg-purple-400/10' },
  done:        { color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
};

// ─── Heatmap (compact) ───────────────────────────────

function MiniHeatmap({ cells, label }: { cells: HeatmapCell[]; label: string }) {
  const countMap = new Map(cells.map((c) => [c.date, c.count]));
  const today = new Date();
  const dates: Date[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d);
  }

  const weeks: { date: Date; count: number }[][] = [];
  let currentWeek: { date: Date; count: number }[] = [];
  for (const d of dates) {
    const dow = d.getDay();
    const mondayIdx = dow === 0 ? 6 : dow - 1;
    if (mondayIdx === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    const key = d.toISOString().slice(0, 10);
    currentWeek.push({ date: d, count: countMap.get(key) ?? 0 });
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  const maxCount = Math.max(...cells.map((c) => c.count), 1);
  const getLevel = (count: number) => {
    if (count === 0) return 0;
    if (count <= maxCount * 0.25) return 1;
    if (count <= maxCount * 0.5) return 2;
    if (count <= maxCount * 0.75) return 3;
    return 4;
  };

  const levelColors = [
    'bg-surface-hover', 'bg-amber-900/40', 'bg-amber-700/50', 'bg-amber-500/60', 'bg-amber-400',
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</p>
        <div className="flex items-center gap-0.5">
          <span className="text-[8px] text-muted">Less</span>
          {levelColors.map((c, i) => (
            <div key={i} className={cn('w-[8px] h-[8px] rounded-[2px]', c)} />
          ))}
          <span className="text-[8px] text-muted">More</span>
        </div>
      </div>
      <div className="overflow-x-auto no-scrollbar">
        <div className="flex gap-[2px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[2px]">
              {wi === 0 && Array.from({ length: 7 - week.length }).map((_, pi) => (
                <div key={`p-${pi}`} className="w-[8px] h-[8px]" />
              ))}
              {week.map((day, di) => (
                <div
                  key={di}
                  title={`${day.date.toISOString().slice(0, 10)}: ${day.count}`}
                  className={cn('w-[8px] h-[8px] rounded-[1px]', levelColors[getLevel(day.count)])}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Stacked Breakdown Bar ────────────────────────────

function BreakdownBar({ breakdown }: { breakdown: Breakdown }) {
  const items = [
    { key: 'c', label: 'Created', value: breakdown.issues_created, color: 'bg-emerald-500' },
    { key: 'x', label: 'Closed', value: breakdown.issues_closed, color: 'bg-amber-500' },
    { key: 'o', label: 'Comments', value: breakdown.comments, color: 'bg-blue-500' },
    { key: 't', label: 'TLDRs', value: breakdown.tldrs, color: 'bg-purple-500' },
    { key: 's', label: 'Moved', value: breakdown.status_changes, color: 'bg-orange-400' },
    { key: 'u', label: 'Updated', value: breakdown.updates, color: 'bg-cyan-500' },
    { key: 'g', label: 'GitHub', value: breakdown.github, color: 'bg-gray-400' },
  ].filter(i => i.value > 0);

  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return <div className="h-1.5 rounded-full bg-surface-hover" />;

  return (
    <div className="space-y-1">
      <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-hover">
        {items.map((item) => (
          <div
            key={item.key}
            className={cn('h-full', item.color)}
            style={{ width: `${(item.value / total) * 100}%` }}
            title={`${item.label}: ${item.value}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {items.map((item) => (
          <div key={item.key} className="flex items-center gap-1">
            <div className={cn('w-1.5 h-1.5 rounded-full', item.color)} />
            <span className="text-[9px] text-muted">{item.label} {item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stat Pill ────────────────────────────────────────

function StatPill({ value, label, sub, icon: Icon, color }: {
  value: string | number; label: string; sub?: string;
  icon: React.ElementType; color?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-hover px-3 py-2">
      <Icon size={14} style={color ? { color } : undefined} className={!color ? 'text-muted' : ''} />
      <div className="min-w-0">
        <p className="text-sm font-bold tabular-nums text-primary leading-tight">{value}</p>
        <p className="text-[9px] text-muted uppercase tracking-wider">{label}</p>
      </div>
      {sub && <span className="text-[9px] text-muted ml-auto">{sub}</span>}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────

export function GamificationDashboard() {
  const { getToken } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['gamification-dashboard'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) return null;
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://api.baaton.dev'}/api/v1/gamification/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      return json.data as DashboardData;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-2 gap-4">
          <div className="h-48 rounded-xl bg-surface" />
          <div className="h-48 rounded-xl bg-surface" />
        </div>
        <div className="h-32 rounded-xl bg-surface" />
      </div>
    );
  }

  if (!data) return null;

  const { personal: p, org: o, projects, contributors, assigned } = data;
  const VIcon = p.velocity_trend === 'up' ? TrendingUp : p.velocity_trend === 'down' ? TrendingDown : Minus;
  const vColor = p.velocity_trend === 'up' ? '#22c55e' : p.velocity_trend === 'down' ? '#ef4444' : undefined;
  const projectMax = Math.max(...projects.map(pr => pr.actions_30d), 1);

  return (
    <div className="space-y-4">
      {/* ── Two-column: Personal vs Org ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Personal */}
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User size={14} className="text-amber-500" />
              <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">You</h3>
            </div>
            {p.streak > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-orange-500/10 border border-orange-500/20 text-orange-400">
                <Flame size={10} className={p.streak >= 3 ? 'animate-pulse' : ''} />
                {p.streak}d
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <StatPill icon={Zap} value={p.velocity_7d.toFixed(1)} label="Velocity" sub="/day" color={vColor} />
            <StatPill icon={VIcon} value={p.this_week} label="This week" color={vColor} />
            <StatPill icon={Clock} value={p.today} label="Today" />
          </div>

          {/* Goal */}
          {p.goal !== null && p.goal > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-1.5">
              <Target size={12} className="text-amber-500 shrink-0" />
              <p className="text-[10px] text-secondary">
                <span className="font-bold text-amber-400">{p.goal}</span> to beat your best week ({p.best_week})
              </p>
            </div>
          )}

          <BreakdownBar breakdown={p.breakdown} />
          <MiniHeatmap cells={p.heatmap} label="Your contributions — 90 days" />
        </div>

        {/* RIGHT: Org / Projects */}
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot size={14} className="text-purple-500" />
              <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">All Projects</h3>
            </div>
            <span className="text-[10px] text-muted">{o.velocity_7d.toFixed(1)} actions/day</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <StatPill icon={Zap} value={o.velocity_7d.toFixed(1)} label="Velocity" sub="/day" color="#a855f7" />
            <StatPill icon={TrendingUp} value={o.this_week} label="This week" color="#a855f7" />
            <StatPill icon={Clock} value={o.today} label="Today" color="#a855f7" />
          </div>

          {/* Per-project bars */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">30-day activity</p>
            {projects.map((pr, i) => (
              <div key={pr.id} className="flex items-center gap-2">
                <Circle size={8} className={cn('shrink-0 fill-current', PROJECT_DOT_COLORS[i % PROJECT_DOT_COLORS.length])} />
                <span className="text-[10px] font-mono text-muted w-8 shrink-0">{pr.prefix}</span>
                <div className="flex-1 h-2 rounded-full bg-surface-hover overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', PROJECT_COLORS[i % PROJECT_COLORS.length])}
                    style={{ width: `${(pr.actions_30d / projectMax) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] font-medium text-secondary tabular-nums w-6 text-right">{pr.actions_30d}</span>
              </div>
            ))}
          </div>

          {/* Contributors */}
          {contributors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">Contributors</p>
              <div className="flex flex-wrap gap-1.5">
                {contributors.map((c) => (
                  <div
                    key={c.user_id}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border',
                      c.is_agent
                        ? 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                        : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                    )}
                  >
                    {c.is_agent ? <Bot size={9} /> : <User size={9} />}
                    {c.name}
                    <span className="font-bold">{c.actions}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <BreakdownBar breakdown={o.breakdown} />
          <MiniHeatmap cells={o.heatmap} label="All activity — 90 days" />
        </div>
      </div>

      {/* ── Assigned Issues ── */}
      {assigned.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">
              Assigned to you
            </h3>
            <span className="text-[10px] text-muted">{assigned.length} open</span>
          </div>
          <div className="space-y-1">
            {assigned.map((issue) => {
              const prio = PRIORITY_CONFIG[issue.priority ?? 'medium'] ?? PRIORITY_CONFIG.medium;
              const stat = STATUS_CONFIG[issue.status] ?? STATUS_CONFIG.backlog;
              return (
                <button
                  key={issue.id}
                  onClick={() => navigate(`/all-issues?issue=${issue.display_id}`)}
                  className="w-full flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-hover transition-colors text-left group"
                >
                  <prio.icon size={12} className={cn('shrink-0', prio.color)} />
                  <span className="text-[10px] font-mono text-muted shrink-0">{issue.display_id}</span>
                  <span className="text-xs text-primary truncate flex-1 min-w-0 group-hover:text-amber-400 transition-colors">
                    {issue.title}
                  </span>
                  <span className={cn(
                    'text-[9px] px-1.5 py-0.5 rounded-full shrink-0',
                    stat.bg, stat.color,
                  )}>
                    {issue.status.replace('_', ' ')}
                  </span>
                  <span className="text-[9px] text-muted shrink-0">{issue.project_prefix}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
