import { useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Milestone, Issue } from '@/lib/types';

interface GanttTimelineProps {
  milestones: Milestone[];
  issuesByMilestone: Record<string, Issue[]>;
}

/* ── Helpers ────────────────────────────────────── */

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

function formatWeek(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ── Status colors ──────────────────────────────── */

const STATUS_COLORS: Record<string, { bar: string; fill: string; border: string }> = {
  active: {
    bar: 'bg-blue-100 dark:bg-blue-500/15',
    fill: 'bg-blue-500',
    border: 'border-blue-200 dark:border-blue-500/30',
  },
  completed: {
    bar: 'bg-emerald-100 dark:bg-emerald-500/15',
    fill: 'bg-emerald-500',
    border: 'border-emerald-200 dark:border-emerald-500/30',
  },
  cancelled: {
    bar: 'bg-gray-100 dark:bg-gray-500/15',
    fill: 'bg-gray-400',
    border: 'border-gray-200 dark:border-gray-500/30',
  },
};

export function GanttTimeline({ milestones, issuesByMilestone }: GanttTimelineProps) {
  const { t } = useTranslation();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Calculate date range
  const { rangeStart, rangeEnd, totalDays, columns, columnType } = useMemo(() => {
    const now = new Date();
    let earliest = now;
    let latest = addDays(now, 30);

    for (const m of milestones) {
      const created = new Date(m.created_at);
      const target = m.target_date ? new Date(m.target_date) : addDays(created, 30);
      if (created < earliest) earliest = created;
      if (target > latest) latest = target;
    }

    // Add buffer
    const start = addDays(earliest, -7);
    const end = addDays(latest, 14);
    const total = diffDays(start, end);

    // Determine column granularity
    let cols: { date: Date; label: string }[] = [];
    let colType: 'day' | 'week' | 'month' = 'week';

    if (total <= 60) {
      // Show weeks
      colType = 'week';
      let current = new Date(start);
      // Align to Monday
      current.setDate(current.getDate() - current.getDay() + 1);
      while (current < end) {
        cols.push({ date: new Date(current), label: formatWeek(current) });
        current = addDays(current, 7);
      }
    } else {
      // Show months
      colType = 'month';
      let current = new Date(start.getFullYear(), start.getMonth(), 1);
      while (current < end) {
        cols.push({ date: new Date(current), label: formatMonth(current) });
        const next = new Date(current);
        next.setMonth(next.getMonth() + 1);
        current = next;
      }
    }

    return {
      rangeStart: start,
      rangeEnd: end,
      totalDays: total,
      columns: cols,
      columnType: colType,
    };
  }, [milestones]);

  // Today position
  const today = new Date();
  const todayOffset = totalDays > 0 ? (diffDays(rangeStart, today) / totalDays) * 100 : 0;
  const showTodayLine = todayOffset >= 0 && todayOffset <= 100;

  if (milestones.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-border bg-white dark:bg-surface shadow-sm overflow-hidden">
      {/* Scrollable container */}
      <div className="overflow-x-auto">
        <div className="min-w-[700px] relative">
          {/* Column headers */}
          <div className="flex border-b border-gray-100 dark:border-border bg-gray-50/50 dark:bg-surface/50">
            {/* Label column */}
            <div className="w-52 shrink-0 px-4 py-2.5 text-[10px] font-medium text-gray-500 dark:text-muted uppercase tracking-wider">
              {t('milestones.title')}
            </div>
            {/* Timeline columns */}
            <div className="flex-1 relative">
              <div className="flex">
                {columns.map((col, i) => (
                  <div
                    key={i}
                    className="flex-1 px-2 py-2.5 text-[10px] font-medium text-gray-400 dark:text-muted text-center border-l border-gray-100 dark:border-border/50 min-w-[60px]"
                  >
                    {col.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Milestone rows */}
          <div className="relative">
            {/* Today line */}
            {showTodayLine && (
              <div
                className="absolute top-0 bottom-0 z-10 pointer-events-none"
                style={{ left: `calc(208px + (100% - 208px) * ${todayOffset / 100})` }}
              >
                <div className="w-px h-full border-l-2 border-dashed border-red-400/60" />
                <div className="absolute -top-0 -translate-x-1/2 rounded-full bg-red-500 px-1.5 py-0.5 text-[8px] font-medium text-white whitespace-nowrap">
                  {t('milestones.today')}
                </div>
              </div>
            )}

            {milestones.map((milestone) => {
              const issues = issuesByMilestone[milestone.id] || [];
              const done = issues.filter((i) => i.status === 'done').length;
              const total = issues.length;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;

              const startDate = new Date(milestone.created_at);
              const endDate = milestone.target_date
                ? new Date(milestone.target_date)
                : addDays(startDate, 30);

              const startPct = Math.max(0, Math.min(100, (diffDays(rangeStart, startDate) / totalDays) * 100));
              const endPct = Math.max(0, Math.min(100, (diffDays(rangeStart, endDate) / totalDays) * 100));
              const widthPct = Math.max(2, endPct - startPct);

              const colors = STATUS_COLORS[milestone.status] || STATUS_COLORS.active;
              const isOverdue = milestone.target_date && new Date(milestone.target_date) < today && milestone.status === 'active';
              const isHovered = hoveredId === milestone.id;

              return (
                <div
                  key={milestone.id}
                  className="flex items-center border-b border-gray-50 dark:border-border/30 hover:bg-gray-50/50 dark:hover:bg-surface-hover/30 transition-colors"
                  onMouseEnter={() => setHoveredId(milestone.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Label */}
                  <div className="w-52 shrink-0 px-4 py-3">
                    <div className="text-xs font-medium text-gray-900 dark:text-primary truncate">
                      {milestone.name}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-gray-400 dark:text-muted">
                        {done}/{total} {t('milestones.issues')}
                      </span>
                      <span className="text-[10px] font-medium text-gray-500 dark:text-secondary tabular-nums">
                        {pct}%
                      </span>
                    </div>
                  </div>

                  {/* Bar */}
                  <div className="flex-1 relative h-10 py-1.5">
                    <div
                      className={cn(
                        'absolute top-1.5 h-7 rounded-md border shadow-sm transition-all cursor-pointer',
                        colors.bar,
                        colors.border,
                        isHovered && 'shadow-md ring-1 ring-accent/20',
                      )}
                      style={{
                        left: `${startPct}%`,
                        width: `${widthPct}%`,
                      }}
                    >
                      {/* Progress fill */}
                      <div
                        className={cn(
                          'h-full rounded-md transition-all duration-300',
                          isOverdue ? 'bg-red-500/30' : colors.fill,
                          'opacity-40',
                        )}
                        style={{ width: `${pct}%` }}
                      />

                      {/* Label inside bar */}
                      {widthPct > 8 && (
                        <div className="absolute inset-0 flex items-center px-2 overflow-hidden">
                          <span className="text-[10px] font-medium text-gray-700 dark:text-primary truncate">
                            {milestone.name}
                          </span>
                        </div>
                      )}

                      {/* Tooltip */}
                      {isHovered && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 pointer-events-none">
                          <div className="rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-surface shadow-xl px-3 py-2 text-[11px] whitespace-nowrap">
                            <div className="font-semibold text-gray-900 dark:text-primary mb-1">{milestone.name}</div>
                            <div className="flex items-center gap-3 text-gray-500 dark:text-muted">
                              <span>{t('milestones.progress')}: {pct}%</span>
                              <span>{done}/{total} {t('milestones.issues')}</span>
                            </div>
                            {milestone.target_date && (
                              <div className="text-gray-400 dark:text-muted mt-0.5">
                                {t('milestones.targetDate')}: {new Date(milestone.target_date).toLocaleDateString()}
                              </div>
                            )}
                            {isOverdue && (
                              <div className="text-red-500 font-medium mt-0.5">{t('milestones.overdue')}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
