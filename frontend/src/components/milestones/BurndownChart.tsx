import { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Issue } from '@/lib/types';

interface BurndownChartProps {
  issues: Issue[];
  startDate: string;        // milestone created_at
  targetDate: string | null; // milestone target_date
}

/* ── Helpers ────────────────────────────────────── */

function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function BurndownChart({ issues, startDate, targetDate }: BurndownChartProps) {
  const { t } = useTranslation();

  const chartData = useMemo(() => {
    const total = issues.length;
    if (total === 0) return null;

    const start = new Date(startDate);
    const end = targetDate ? new Date(targetDate) : addDays(start, 30);
    const today = new Date();
    const chartEnd = today < end ? end : today;
    const totalSpan = Math.max(diffDays(start, chartEnd), 1);

    // Build the "done by day" map — issues that transitioned to done
    // We approximate: if issue.status === 'done', use updated_at as the done date
    const doneByDay: Record<string, number> = {};
    for (const issue of issues) {
      if (issue.status === 'done') {
        const day = toDay(new Date(issue.updated_at));
        doneByDay[day] = (doneByDay[day] || 0) + 1;
      }
    }

    // Build actual line: cumulative remaining issues per day
    const actualPoints: { day: number; remaining: number }[] = [];
    let cumDone = 0;
    const currentDay = new Date(start);

    // Start point
    actualPoints.push({ day: 0, remaining: total });

    while (currentDay <= chartEnd) {
      const dayStr = toDay(currentDay);
      if (doneByDay[dayStr]) {
        cumDone += doneByDay[dayStr];
      }
      const dayIdx = diffDays(start, currentDay);
      if (dayIdx > 0) {
        actualPoints.push({ day: dayIdx, remaining: total - cumDone });
      }
      currentDay.setDate(currentDay.getDate() + 1);
    }

    // Ideal line: straight from total → 0 over the planned duration
    const plannedSpan = Math.max(diffDays(start, end), 1);
    const idealPoints = [
      { day: 0, remaining: total },
      { day: plannedSpan, remaining: 0 },
    ];

    // Today position
    const todayIdx = diffDays(start, today);

    return { total, totalSpan, idealPoints, actualPoints, plannedSpan, todayIdx };
  }, [issues, startDate, targetDate]);

  if (!chartData || chartData.total === 0) {
    return null;
  }

  const { total, totalSpan, idealPoints, actualPoints, plannedSpan, todayIdx } = chartData;

  // SVG dimensions
  const W = 400;
  const H = 160;
  const PAD_L = 32;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 24;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const xScale = (day: number) => PAD_L + (day / Math.max(totalSpan, plannedSpan)) * chartW;
  const yScaleCorrect = (remaining: number) => PAD_T + (1 - remaining / total) * chartH;

  // Build SVG paths
  const idealPath = idealPoints.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${xScale(p.day).toFixed(1)},${yScaleCorrect(p.remaining).toFixed(1)}`
  ).join(' ');

  // Simplify actual path: only keep points where remaining changes (to avoid huge paths)
  const simplifiedActual: typeof actualPoints = [];
  for (let i = 0; i < actualPoints.length; i++) {
    const prev = simplifiedActual[simplifiedActual.length - 1];
    const point = actualPoints[i];
    if (!prev || prev.remaining !== point.remaining || i === actualPoints.length - 1) {
      // Step function: go horizontal first, then vertical
      if (prev && prev.remaining !== point.remaining) {
        simplifiedActual.push({ day: point.day, remaining: prev.remaining });
      }
      simplifiedActual.push(point);
    }
  }

  const actualPath = simplifiedActual.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${xScale(p.day).toFixed(1)},${yScaleCorrect(p.remaining).toFixed(1)}`
  ).join(' ');

  // Y-axis labels
  const yLabels = [0, Math.round(total / 2), total];

  // X-axis labels
  const xLabels: { day: number; label: string }[] = [];
  const stepDays = Math.max(Math.round(Math.max(totalSpan, plannedSpan) / 4), 1);
  for (let d = 0; d <= Math.max(totalSpan, plannedSpan); d += stepDays) {
    const date = addDays(new Date(startDate), d);
    xLabels.push({
      day: d,
      label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    });
  }

  // Status: ahead or behind?
  const lastActual = actualPoints[actualPoints.length - 1];
  const idealAtToday = Math.max(0, total - (todayIdx / plannedSpan) * total);
  const isAhead = lastActual && lastActual.remaining <= idealAtToday;

  return (
    <div className="rounded-lg border border-gray-100 dark:border-border bg-gray-50/30 dark:bg-surface-hover/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-gray-500 dark:text-muted uppercase tracking-wider">
          {t('milestones.burndown')}
        </span>
        <span className={cn(
          'text-[10px] font-medium',
          isAhead ? 'text-emerald-500' : 'text-amber-500',
        )}>
          {isAhead ? t('milestones.onTrack') : t('milestones.atRisk')}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {yLabels.map((val) => (
          <g key={val}>
            <line
              x1={PAD_L}
              y1={yScaleCorrect(val)}
              x2={W - PAD_R}
              y2={yScaleCorrect(val)}
              stroke="currentColor"
              className="text-gray-200 dark:text-border"
              strokeWidth={0.5}
              strokeDasharray="4,4"
            />
            <text
              x={PAD_L - 4}
              y={yScaleCorrect(val) + 3}
              textAnchor="end"
              className="text-gray-400 dark:text-muted"
              fontSize={8}
              fill="currentColor"
            >
              {val}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {xLabels.map(({ day, label }) => (
          <text
            key={day}
            x={xScale(day)}
            y={H - 4}
            textAnchor="middle"
            className="text-gray-400 dark:text-muted"
            fontSize={7}
            fill="currentColor"
          >
            {label}
          </text>
        ))}

        {/* Ideal line (dashed gray) */}
        <path
          d={idealPath}
          fill="none"
          stroke="currentColor"
          className="text-gray-300 dark:text-gray-600"
          strokeWidth={1.5}
          strokeDasharray="6,4"
        />

        {/* Actual line (solid colored) */}
        <path
          d={actualPath}
          fill="none"
          stroke="currentColor"
          className={isAhead ? 'text-emerald-500' : 'text-amber-500'}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Today line */}
        {todayIdx >= 0 && todayIdx <= Math.max(totalSpan, plannedSpan) && (
          <>
            <line
              x1={xScale(todayIdx)}
              y1={PAD_T}
              x2={xScale(todayIdx)}
              y2={H - PAD_B}
              stroke="currentColor"
              className="text-red-400"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            <text
              x={xScale(todayIdx)}
              y={PAD_T - 2}
              textAnchor="middle"
              className="text-red-500"
              fontSize={7}
              fontWeight={600}
              fill="currentColor"
            >
              {t('milestones.today')}
            </text>
          </>
        )}

        {/* Current point dot */}
        {lastActual && (
          <circle
            cx={xScale(lastActual.day)}
            cy={yScaleCorrect(lastActual.remaining)}
            r={3}
            fill="currentColor"
            className={isAhead ? 'text-emerald-500' : 'text-amber-500'}
          />
        )}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-1.5">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-px border-t border-dashed border-gray-400 dark:border-gray-500" />
          <span className="text-[9px] text-gray-400 dark:text-muted">{t('milestones.idealLine')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={cn('w-4 h-0.5 rounded-full', isAhead ? 'bg-emerald-500' : 'bg-amber-500')} />
          <span className="text-[9px] text-gray-400 dark:text-muted">{t('milestones.actualLine')}</span>
        </div>
      </div>
    </div>
  );
}
