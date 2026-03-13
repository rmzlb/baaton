import { useAuth } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Flame, TrendingUp, TrendingDown, Minus, Trophy, Zap,
  Target, Bot, User, Plus, CheckCircle2, MessageSquare,
  ArrowRight, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserActivityStats, HeatmapCell } from '@/lib/types';
import { useTranslation } from 'react-i18next';

// ─── Activity Heatmap (GitHub-style) ──────────────────

function ActivityHeatmap({ cells, days = 90 }: { cells: HeatmapCell[]; days?: number }) {
  const countMap = new Map(cells.map((c) => [c.date, c.count]));
  const today = new Date();
  const dates: Date[] = [];
  for (let i = days - 1; i >= 0; i--) {
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
  const getLevel = (count: number): number => {
    if (count === 0) return 0;
    if (count <= maxCount * 0.25) return 1;
    if (count <= maxCount * 0.5) return 2;
    if (count <= maxCount * 0.75) return 3;
    return 4;
  };

  const levelColors = [
    'bg-surface-hover',
    'bg-amber-900/40',
    'bg-amber-700/50',
    'bg-amber-500/60',
    'bg-amber-400',
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">
          Last {days} days
        </p>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-muted">Less</span>
          {levelColors.map((c, i) => (
            <div key={i} className={cn('w-[10px] h-[10px] rounded-[2px]', c)} />
          ))}
          <span className="text-[9px] text-muted">More</span>
        </div>
      </div>
      <div className="overflow-x-auto no-scrollbar">
        <div className="flex gap-[3px]" style={{ minWidth: `${weeks.length * 13}px` }}>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {wi === 0 && Array.from({ length: 7 - week.length }).map((_, pi) => (
                <div key={`pad-${pi}`} className="w-[10px] h-[10px]" />
              ))}
              {week.map((day, di) => {
                const level = getLevel(day.count);
                const dateStr = day.date.toISOString().slice(0, 10);
                return (
                  <div
                    key={di}
                    title={`${dateStr}: ${day.count} actions`}
                    className={cn(
                      'w-[10px] h-[10px] rounded-[2px] transition-colors cursor-default',
                      levelColors[level],
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Breakdown bar — horizontal stacked bar ───────────

function BreakdownBar({ breakdown }: { breakdown: UserActivityStats['breakdown'] }) {
  const items = [
    { key: 'issues_created', label: 'Created', value: breakdown.issues_created, color: 'bg-emerald-500' },
    { key: 'issues_closed', label: 'Closed', value: breakdown.issues_closed, color: 'bg-amber-500' },
    { key: 'comments', label: 'Comments', value: breakdown.comments, color: 'bg-blue-500' },
    { key: 'tldrs', label: 'TLDRs', value: breakdown.tldrs, color: 'bg-purple-500' },
    { key: 'status_changes', label: 'Moved', value: breakdown.status_changes, color: 'bg-orange-400' },
    { key: 'updates', label: 'Updated', value: breakdown.updates, color: 'bg-cyan-500' },
    { key: 'github', label: 'GitHub', value: breakdown.github, color: 'bg-gray-400' },
  ].filter(i => i.value > 0);

  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">This week breakdown</p>
      {/* Stacked bar */}
      <div className="flex h-2 rounded-full overflow-hidden bg-surface-hover">
        {items.map((item) => (
          <div
            key={item.key}
            className={cn('h-full transition-all', item.color)}
            style={{ width: `${(item.value / total) * 100}%` }}
            title={`${item.label}: ${item.value}`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {items.map((item) => (
          <div key={item.key} className="flex items-center gap-1">
            <div className={cn('w-2 h-2 rounded-full', item.color)} />
            <span className="text-[10px] text-muted">{item.label}</span>
            <span className="text-[10px] font-medium text-secondary">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Contributors row ─────────────────────────────────

function Contributors({ contributors }: { contributors: UserActivityStats['contributors'] }) {
  if (!contributors || contributors.length === 0) return null;
  const total = contributors.reduce((s, c) => s + c.actions, 0);

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">Top contributors</p>
      <div className="space-y-1">
        {contributors.map((c) => (
          <div key={c.user_id} className="flex items-center gap-2">
            <div className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold',
              c.is_agent ? 'bg-purple-500/20 text-purple-400' : 'bg-amber-500/20 text-amber-400'
            )}>
              {c.is_agent ? <Bot size={10} /> : <User size={10} />}
            </div>
            <span className="text-xs text-secondary truncate flex-1 min-w-0">
              {c.name}
              {c.is_agent && <span className="text-[9px] text-muted ml-1">agent</span>}
            </span>
            {/* Mini bar */}
            <div className="w-16 h-1.5 rounded-full bg-surface-hover overflow-hidden">
              <div
                className={cn('h-full rounded-full', c.is_agent ? 'bg-purple-500/60' : 'bg-amber-500/60')}
                style={{ width: `${(c.actions / total) * 100}%` }}
              />
            </div>
            <span className="text-[10px] font-medium text-muted tabular-nums w-6 text-right">{c.actions}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mini stat card ───────────────────────────────────

function MiniStat({
  icon: Icon, value, label, sub, color,
}: {
  icon: React.ElementType; value: string | number; label: string; sub?: string; color?: string;
}) {
  return (
    <div className="rounded-lg bg-surface-hover p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} style={color ? { color } : undefined} className={!color ? 'text-muted' : ''} />
        <span className="text-[10px] text-muted uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-bold tabular-nums text-primary">{value}</p>
      {sub && <p className="text-[10px] text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main Widget ──────────────────────────────────────

export function GamificationWidget() {
  const { getToken } = useAuth();
  const { t } = useTranslation();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['gamification-me'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) return null;
      return api.gamification.me(token);
    },
    staleTime: 60_000,
  });

  const { data: heatmapData } = useQuery({
    queryKey: ['gamification-heatmap'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) return null;
      return api.gamification.heatmap(token, 90);
    },
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 space-y-3 animate-pulse">
        <div className="h-4 w-28 rounded bg-surface-hover" />
        <div className="grid grid-cols-3 gap-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-surface-hover" />)}
        </div>
        <div className="h-20 rounded bg-surface-hover" />
      </div>
    );
  }

  const g: UserActivityStats = stats ?? {
    scope: 'org',
    current_streak: 0, longest_streak: 0,
    velocity_7d: 0, velocity_30d: 0, velocity_trend: 'stable',
    personal_bests: { best_day: 0, best_week: 0 },
    today: { actions: 0 }, this_week: { actions: 0 },
    completion_rate: 0, goal: null,
    breakdown: { issues_created: 0, issues_closed: 0, comments: 0, tldrs: 0, status_changes: 0, updates: 0, github: 0 },
    contributors: [],
  };

  const VelocityIcon = g.velocity_trend === 'up' ? TrendingUp : g.velocity_trend === 'down' ? TrendingDown : Minus;
  const velocityColor = g.velocity_trend === 'up' ? '#22c55e' : g.velocity_trend === 'down' ? '#ef4444' : undefined;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">
            {g.scope === 'org' ? 'Team Activity' : 'Your Activity'}
          </h3>
          {g.scope === 'org' && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
              includes agents
            </span>
          )}
        </div>
        {g.current_streak > 0 && (
          <span className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold',
            'bg-orange-500/10 border border-orange-500/20 text-orange-400',
          )}>
            <Flame size={12} className={g.current_streak >= 3 ? 'animate-pulse' : ''} />
            {g.current_streak}d streak
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat
          icon={Zap}
          value={g.velocity_7d.toFixed(1)}
          label="Velocity"
          sub={`${g.velocity_30d.toFixed(1)}/d (30d)`}
          color={velocityColor}
        />
        <MiniStat
          icon={Trophy}
          value={g.this_week.actions}
          label="This Week"
          sub={g.personal_bests.best_week > 0 ? `Best: ${g.personal_bests.best_week}` : undefined}
          color="#f59e0b"
        />
        <MiniStat
          icon={VelocityIcon}
          value={g.today.actions}
          label="Today"
          sub={g.personal_bests.best_day > 0 ? `Best: ${g.personal_bests.best_day}` : undefined}
          color={velocityColor}
        />
      </div>

      {/* Goal nudge */}
      {g.goal !== null && g.goal > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-2">
          <Target size={14} className="text-amber-500 shrink-0" />
          <p className="text-[11px] text-secondary">
            <span className="font-semibold text-amber-400">{g.goal}</span> more to beat your best week
          </p>
          <ArrowRight size={12} className="text-muted ml-auto" />
        </div>
      )}

      {/* Completion rate + quick stats */}
      {g.completion_rate > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={12} className="text-emerald-500" />
            <span className="text-[11px] text-secondary">
              <span className="font-semibold">{g.completion_rate}%</span> completion rate
            </span>
          </div>
        </div>
      )}

      {/* Breakdown bar */}
      {g.breakdown && <BreakdownBar breakdown={g.breakdown} />}

      {/* Contributors */}
      {g.contributors && <Contributors contributors={g.contributors} />}

      {/* Heatmap */}
      {heatmapData && <ActivityHeatmap cells={heatmapData.cells} days={heatmapData.days} />}
    </div>
  );
}
