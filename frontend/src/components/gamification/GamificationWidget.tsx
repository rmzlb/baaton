import { useAuth } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Flame, TrendingUp, TrendingDown, Minus, Trophy, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserActivityStats, HeatmapCell } from '@/lib/types';

// ─── Activity Heatmap (GitHub-style) ──────────────────

function ActivityHeatmap({ cells, days = 90 }: { cells: HeatmapCell[]; days?: number }) {
  // Build date → count map
  const countMap = new Map(cells.map((c) => [c.date, c.count]));

  // Generate all dates for the grid
  const today = new Date();
  const dates: Date[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d);
  }

  // Group by weeks (columns) — each week starts on Monday
  const weeks: { date: Date; count: number }[][] = [];
  let currentWeek: { date: Date; count: number }[] = [];

  for (const d of dates) {
    const dow = d.getDay(); // 0=Sun
    const mondayIdx = dow === 0 ? 6 : dow - 1; // 0=Mon

    if (mondayIdx === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }

    const key = d.toISOString().slice(0, 10);
    currentWeek.push({ date: d, count: countMap.get(key) ?? 0 });
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  // Intensity levels (0-4)
  const maxCount = Math.max(...cells.map((c) => c.count), 1);
  const getLevel = (count: number): number => {
    if (count === 0) return 0;
    if (count <= maxCount * 0.25) return 1;
    if (count <= maxCount * 0.5) return 2;
    if (count <= maxCount * 0.75) return 3;
    return 4;
  };

  // Amber-based colors matching Baaton accent
  const levelColors = [
    'bg-surface-hover',           // 0: empty
    'bg-amber-900/40',            // 1: low
    'bg-amber-700/50',            // 2: medium
    'bg-amber-500/60',            // 3: high
    'bg-amber-400',               // 4: max
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">
          Activity — last {days} days
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
              {/* Pad beginning of first week */}
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

// ─── Stat mini card ───────────────────────────────────

function MiniStat({
  icon: Icon,
  value,
  label,
  sub,
  color,
}: {
  icon: React.ElementType;
  value: string | number;
  label: string;
  sub?: string;
  color?: string;
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

  const { data: stats, isLoading: statsLoading } = useQuery({
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

  if (statsLoading) {
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
    current_streak: 0,
    longest_streak: 0,
    velocity_7d: 0,
    velocity_30d: 0,
    velocity_trend: 'stable',
    personal_bests: { best_day: 0, best_week: 0 },
    today: { actions: 0 },
    this_week: { actions: 0 },
  };

  const VelocityIcon = g.velocity_trend === 'up'
    ? TrendingUp
    : g.velocity_trend === 'down'
      ? TrendingDown
      : Minus;

  const velocityColor = g.velocity_trend === 'up'
    ? '#22c55e'
    : g.velocity_trend === 'down'
      ? '#ef4444'
      : undefined;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-4">
      {/* Header with streak */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">Your Activity</h3>
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
          sub="issues/day (7d)"
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

      {/* Heatmap */}
      {heatmapData && (
        <ActivityHeatmap cells={heatmapData.cells} days={heatmapData.days} />
      )}
    </div>
  );
}
