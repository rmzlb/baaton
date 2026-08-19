import { useOrganizationList, useOrganization } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import {
  Kanban, ArrowRight, Clock, Circle, Eye,
  CheckCircle2, Building2, ChevronRight,
  TrendingUp, Zap, Timer, Flame, Bot, User, Target,
  LayoutGrid, Table2, AlertTriangle,
  PenLine, Layers, ChevronUp, ChevronDown, EyeOff, XCircle,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { GlobalCreateIssueButton } from '@/components/issues/GlobalCreateIssue';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { cn } from '@/lib/utils';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import type { ActivityEntry, HeatmapCell } from '@/lib/types';

interface DashboardProject {
  id: string;
  name: string;
  slug: string;
  prefix: string;
  description: string | null;
  status_counts: Record<string, number>;
  total_issues: number;
  created_this_week: number;
  created_this_month: number;
  closed_this_week: number;
  closed_this_month: number;
  last_activity_at: string | null;
  /// Median days the project's `in_review` queue has been waiting, null when empty.
  review_median_days: number | null;
  /// How many of those crossed 14 days.
  review_stuck: number;
  assignees: string[];
}

interface DashboardOrg {
  id: string;
  name: string;
  slug: string;
  image_url?: string | null;
  is_active: boolean;
  projects: DashboardProject[];
}

interface DashboardMetrics {
  issues_created: Array<{ date: string; count: number }>;
  issues_closed: Array<{ date: string; count: number }>;
  avg_resolution_hours: number | null;
  active_issues: number;
  client_wait: { waiting: number; median_days: number | null; stuck: number } | null;
  period_days: number;
}

interface DashboardPerson {
  velocity_7d: number;
  velocity_30d: number;
  velocity_trend: string;
  this_week: number;
  today: number;
  streak: number;
  best_week: number;
  goal: number | null;
  breakdown: Record<string, number>;
  heatmap: HeatmapCell[];
}

interface DashboardProjectActivity {
  id: string;
  name: string;
  prefix: string;
  actions_30d: number;
}

interface DashboardContributor {
  user_id: string;
  name: string;
  actions: number;
  is_agent: boolean;
}

interface DashboardAssignedIssue {
  id: string;
  org_id: string | null;
  display_id: string;
  title: string;
  status: string;
  priority: string | null;
  project_prefix: string;
}

interface DashboardSummary {
  orgs: DashboardOrg[];
  metrics: DashboardMetrics;
  personal: DashboardPerson;
  org_activity: {
    velocity_7d: number;
    this_week: number;
    today: number;
    breakdown: Record<string, number>;
    heatmap: HeatmapCell[];
  };
  projects_activity: DashboardProjectActivity[];
  contributors: DashboardContributor[];
  assigned: DashboardAssignedIssue[];
  recent_activity: ActivityEntry[];
}

// ─── Greeting ──────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

// ─── Unified Metrics Bar ───────────────────────────────

function MetricsBar({ items }: {
  items: Array<{ label: string; value: string | number; sub?: string; color: string; icon: React.ElementType }>;
}) {
  return (
    <div className="flex flex-col sm:flex-row rounded-xl border border-border bg-surface overflow-hidden">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={cn(
            'flex-1 p-4 md:p-5',
            i < items.length - 1 && 'border-b sm:border-b-0 sm:border-r border-border/50',
          )}
        >
          <div className="flex items-center gap-2 text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
            <item.icon size={14} style={{ color: item.color }} />
            {item.label}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-primary tracking-tight">{item.value}</span>
            {item.sub && <span className="text-xs text-muted">{item.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Activity Chart (SVG) ──────────────────────────────

function ActivityChart({ created, closed, days = 30 }: {
  created: Array<{ date: string; count: number }>;
  closed: Array<{ date: string; count: number }>;
  days?: number;
}) {
  const width = 600, height = 100, padX = 10, padY = 8;
  const plotW = width - padX * 2, plotH = height - padY * 2;
  const dateRange: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dateRange.push(d.toISOString().slice(0, 10));
  }
  const cMap = Object.fromEntries(created.map(p => [p.date, p.count]));
  const xMap = Object.fromEntries(closed.map(p => [p.date, p.count]));
  const cData = dateRange.map(d => cMap[d] ?? 0);
  const xData = dateRange.map(d => xMap[d] ?? 0);
  const max = Math.max(...cData, ...xData, 1);
  const toX = (i: number) => padX + (i / (dateRange.length - 1)) * plotW;
  const toY = (v: number) => padY + plotH - (v / max) * plotH;
  const pathFor = (data: number[]) => data.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: '100px' }}>
        {[0.25, 0.5, 0.75].map(p => (
          <line key={p} x1={padX} y1={padY + plotH * (1 - p)} x2={width - padX} y2={padY + plotH * (1 - p)} stroke="currentColor" className="text-border" strokeWidth="0.5" />
        ))}
        <path d={`${pathFor(cData)} L${toX(cData.length - 1).toFixed(1)},${padY + plotH} L${padX},${padY + plotH} Z`} fill="#f59e0b" fillOpacity="0.06" />
        <path d={`${pathFor(xData)} L${toX(xData.length - 1).toFixed(1)},${padY + plotH} L${padX},${padY + plotH} Z`} fill="#22c55e" fillOpacity="0.06" />
        <path d={pathFor(cData)} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={pathFor(xData)} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <div className="flex items-center gap-4 mt-1">
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-500 rounded-full" /><span className="text-[10px] text-muted">Created</span></div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-500 rounded-full" /><span className="text-[10px] text-muted">Closed</span></div>
      </div>
    </div>
  );
}

// ─── Project Card (reference-inspired) ─────────────────

// Avatar colors for contributor initials
const AVATAR_COLORS = [
  { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  { bg: 'bg-orange-500/15', text: 'text-orange-400' },
  { bg: 'bg-purple-500/15', text: 'text-purple-400' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  { bg: 'bg-rose-500/15', text: 'text-rose-400' },
  { bg: 'bg-cyan-500/15', text: 'text-cyan-400' },
];

function ProjectCard({ project, onNavigate }: {
  project: DashboardProject; onNavigate: () => void;
}) {
  const counts = project.status_counts || {};
  const total = project.total_issues || 0;
  const done = counts.done || 0;
  const assignees = project.assignees || [];

  const statusRows = [
    { key: 'todo', label: 'Draft', icon: Circle, color: 'text-blue-500' },
    { key: 'backlog', label: 'Backlog', icon: Circle, color: 'text-muted' },
    { key: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-amber-500' },
    { key: 'not_ok', label: 'Not OK', icon: AlertTriangle, color: 'text-orange-500' },
    { key: 'in_review', label: 'In Review', icon: Eye, color: 'text-purple-500' },
  ];

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(); } }}
      className="group rounded-xl border border-border bg-surface p-5 transition-all hover:border-accent/30 cursor-pointer flex flex-col h-full"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-surface-hover border border-border flex items-center justify-center text-[11px] font-bold font-mono text-secondary">
            {project.prefix}
          </div>
          <div>
            <h3 className="text-sm font-medium text-primary group-hover:text-accent transition-colors">{project.name}</h3>
            <p className="text-xs text-muted">{total} Total Issues</p>
          </div>
        </div>
        <ArrowRight size={14} className="text-muted/30 group-hover:text-muted transition-colors" />
      </div>

      <div className="flex-1 space-y-2.5 mb-5 mt-1">
        {statusRows.map(s => {
          const val = counts[s.key] || 0;
          const dimmed = val === 0;
          return (
            <div key={s.key} className="flex items-center justify-between text-sm">
              <div className={cn('flex items-center gap-2', dimmed ? 'text-muted/50' : 'text-secondary')}>
                <s.icon size={14} className={dimmed ? 'text-muted/30' : s.color} />
                {s.label}
              </div>
              <span className={cn('font-medium tabular-nums', dimmed ? 'text-muted/40' : 'text-primary')}>
                {val}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border/50 mt-auto">
        <div className="flex -space-x-1.5">
          {assignees.slice(0, 3).map((aid, i) => {
            const c = AVATAR_COLORS[i % AVATAR_COLORS.length];
            const initial = aid.startsWith('apikey:') ? '🤖' : aid.charAt(aid.length - 1).toUpperCase();
            return (
              <div key={aid} className={cn(
                'w-6 h-6 rounded-full border border-surface flex items-center justify-center text-[10px] font-medium',
                c.bg, c.text,
              )} style={{ zIndex: 20 - i }}>
                {initial}
              </div>
            );
          })}
          {assignees.length > 3 && (
            <div className="w-6 h-6 rounded-full bg-surface-hover border border-surface flex items-center justify-center text-[10px] font-medium text-muted z-0">
              +{assignees.length - 3}
            </div>
          )}
        </div>

        {done > 0 && (
          <div className="flex items-center gap-1 text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">
            <CheckCircle2 size={12} />
            {done} Done
          </div>
        )}
      </div>
    </div>
  );
}

function OrgSection({ org, onSwitch, onProjectNavigate }: {
  org: DashboardOrg;
  onSwitch?: () => void;
  onProjectNavigate: (project: DashboardProject, orgId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const totalIssues = org.projects.reduce((sum, p) => sum + p.total_issues, 0);
  const totalActive = org.projects.reduce((sum, p) => sum + p.total_issues - (p.status_counts.done || 0) - (p.status_counts.cancelled || 0), 0);

  return (
    <div className="mb-6">
      <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2.5 mb-3 group w-full text-left">
        <ChevronRight size={14} className={cn('text-muted transition-transform', !collapsed && 'rotate-90')} />
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-hover shrink-0 overflow-hidden">
          {org.image_url
            ? <img src={org.image_url} alt="" className="h-5 w-5 object-contain" />
            : <Building2 size={12} className="text-accent" />
          }
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold text-primary truncate">{org.name}</span>
          {org.is_active && (
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-semibold text-accent uppercase tracking-wider">Active</span>
          )}
          <span className="text-[10px] text-muted font-mono shrink-0">
            {org.projects.length} proj · {totalActive} active / {totalIssues}
          </span>
        </div>
        <Link to={`/all-issues?org=${encodeURIComponent(org.slug)}`} onClick={e => e.stopPropagation()} className="shrink-0 text-[10px] text-secondary hover:text-accent transition-colors">
          All issues →
        </Link>
        {!org.is_active && onSwitch && (
          <button onClick={e => { e.stopPropagation(); onSwitch(); }} className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-secondary hover:text-primary transition-colors">
            Switch
          </button>
        )}
      </button>
      {!collapsed && (
        org.projects.length === 0
          ? <div className="rounded-xl border border-border/50 bg-surface/50 p-6 text-center text-sm text-muted">No projects yet</div>
          : <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{org.projects.map(p => (
              <ProjectCard key={p.id} project={p} onNavigate={() => onProjectNavigate(p, org.id)} />
            ))}</div>
      )}
    </div>
  );
}

// ─── GitHub-Style Contribution Heatmap ─────────────────

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];
const CELL = 10;
const GAP = 2;

function MiniHeatmap({ cells, label }: { cells: HeatmapCell[]; label: string }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const countMap = new Map(cells.map(c => [c.date, c.count]));
  const currentYear = new Date().getFullYear();
  const today = new Date();

  // Build dates for the selected calendar year (Jan 1 → Dec 31 or today)
  const yearStart = new Date(year, 0, 1);
  const yearEnd = year === currentYear ? today : new Date(year, 11, 31);
  const dates: Date[] = [];
  for (let d = new Date(yearStart); d <= yearEnd; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d));
  }

  // Group into weeks (Mon=0 ... Sun=6)
  const weeks: { date: Date; count: number; dow: number }[][] = [];
  let cw: { date: Date; count: number; dow: number }[] = [];
  for (const d of dates) {
    const jsDay = d.getDay();
    const dow = jsDay === 0 ? 6 : jsDay - 1; // Mon=0
    if (dow === 0 && cw.length > 0) { weeks.push(cw); cw = []; }
    cw.push({ date: d, count: countMap.get(d.toISOString().slice(0, 10)) ?? 0, dow });
  }
  if (cw.length > 0) weeks.push(cw);

  // Filter cells for this year to compute stats
  const yearCells = cells.filter(c => c.date.startsWith(String(year)));
  const max = Math.max(...yearCells.map(c => c.count), 1);
  const lvl = (n: number) => n === 0 ? 0 : n <= max * 0.25 ? 1 : n <= max * 0.5 ? 2 : n <= max * 0.75 ? 3 : 4;
  const fills = [
    'var(--color-border, #e4e4e7)',
    'rgba(245, 158, 11, 0.25)',
    'rgba(245, 158, 11, 0.45)',
    'rgba(245, 158, 11, 0.70)',
    'rgb(245, 158, 11)',
  ];

  // Month labels at first week of each month
  const monthMarkers: { weekIdx: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((w, wi) => {
    const m = w[0]?.date.getMonth();
    if (m !== undefined && m !== lastMonth) { monthMarkers.push({ weekIdx: wi, label: MONTH_LABELS[m] }); lastMonth = m; }
  });

  const leftPad = 28;
  const svgW = leftPad + weeks.length * (CELL + GAP);
  const svgH = 14 + 7 * (CELL + GAP);
  const totalActions = yearCells.reduce((s, c) => s + c.count, 0);
  // Earliest data year (for nav lower bound)
  const minYear = cells.length > 0 ? Math.min(...cells.map(c => parseInt(c.date.slice(0, 4)))) : currentYear;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</p>
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-muted">{totalActions} actions</p>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setYear(y => Math.max(minYear, y - 1))} disabled={year <= minYear}
              className="w-5 h-5 flex items-center justify-center rounded text-muted hover:bg-surface-hover hover:text-primary disabled:opacity-30 disabled:cursor-default transition-colors text-xs">
              ‹
            </button>
            <span className="text-[10px] font-semibold text-secondary tabular-nums min-w-[30px] text-center">{year}</span>
            <button onClick={() => setYear(y => Math.min(currentYear, y + 1))} disabled={year >= currentYear}
              className="w-5 h-5 flex items-center justify-center rounded text-muted hover:bg-surface-hover hover:text-primary disabled:opacity-30 disabled:cursor-default transition-colors text-xs">
              ›
            </button>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto no-scrollbar">
        <svg width={svgW} height={svgH} className="block">
          {monthMarkers.map(({ weekIdx, label: ml }) => (
            <text key={weekIdx} x={leftPad + weekIdx * (CELL + GAP)} y={10}
              className="fill-muted" fontSize={9} fontFamily="Inter, sans-serif">{ml}</text>
          ))}
          {DAY_LABELS.map((dl, di) => dl ? (
            <text key={di} x={0} y={14 + di * (CELL + GAP) + 8}
              className="fill-muted" fontSize={9} fontFamily="Inter, sans-serif">{dl}</text>
          ) : null)}
          {weeks.map((w, wi) => w.map((d) => (
            <rect key={`${wi}-${d.dow}`} x={leftPad + wi * (CELL + GAP)} y={14 + d.dow * (CELL + GAP)}
              width={CELL} height={CELL} rx={2} fill={fills[lvl(d.count)]} opacity={d.count === 0 ? 0.5 : 1}>
              <title>{d.date.toISOString().slice(0, 10)}: {d.count} action{d.count !== 1 ? 's' : ''}</title>
            </rect>
          )))}
          {/* Legend */}
          <text x={svgW - 95} y={svgH - 1} className="fill-muted" fontSize={8} fontFamily="Inter, sans-serif">Less</text>
          {fills.map((f, i) => (
            <rect key={i} x={svgW - 70 + i * (CELL + GAP)} y={svgH - 10} width={CELL} height={CELL} rx={2}
              fill={f} opacity={i === 0 ? 0.5 : 1} />
          ))}
          <text x={svgW - 6} y={svgH - 1} className="fill-muted" fontSize={8} fontFamily="Inter, sans-serif">More</text>
        </svg>
      </div>
    </div>
  );
}

// ─── Gamification Panel (right column) ─────────────────

const PROJECT_COLORS = ['bg-amber-500', 'bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-rose-500', 'bg-cyan-500'];
const PROJECT_DOT_COLORS = ['text-amber-500', 'text-emerald-500', 'text-blue-500', 'text-purple-500', 'text-rose-500', 'text-cyan-500'];
const PRIORITY_COLORS: Record<string, string> = { urgent: 'text-red-500', high: 'text-orange-500', medium: 'text-amber-500', low: 'text-blue-400' };
const STATUS_BG: Record<string, string> = { backlog: 'bg-gray-500/10 text-gray-400', todo: 'bg-blue-500/10 text-blue-400', in_progress: 'bg-amber-500/10 text-amber-400', not_ok: 'bg-orange-500/10 text-orange-400', in_review: 'bg-purple-500/10 text-purple-400' };

function GamificationPanel({ data, onIssueClick }: { data: DashboardSummary; onIssueClick: (displayId: string, orgId: string | null) => void }) {
  const { personal: p, org_activity: o, projects_activity: projs, contributors, assigned } = data;
  const projMax = Math.max(...projs.map(pr => pr.actions_30d), 1);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User size={14} className="text-amber-500" />
            <h3 className="text-[10px] font-semibold text-muted uppercase tracking-wider">You</h3>
          </div>
          {p.streak > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-orange-500/10 border border-orange-500/20 text-orange-400">
              <Flame size={10} className={p.streak >= 3 ? 'animate-pulse' : ''} /> {p.streak}d
            </span>
          )}
        </div>

        <div className="flex rounded-lg border border-border/50 overflow-hidden">
          {[
            { label: 'Velocity', value: p.velocity_7d.toFixed(1), sub: '/day' },
            { label: 'This Week', value: String(p.this_week) },
            { label: 'Today', value: String(p.today) },
          ].map((s, i) => (
            <div key={s.label} className={cn('flex-1 p-2.5 text-center', i < 2 && 'border-r border-border/50')}>
              <p className="text-lg font-bold tabular-nums text-primary">{s.value}{s.sub && <span className="text-[9px] text-muted">{s.sub}</span>}</p>
              <p className="text-[9px] text-muted uppercase tracking-wider">{s.label}</p>
            </div>
          ))}
        </div>

        {p.goal != null && p.goal > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-1.5">
            <Target size={12} className="text-amber-500" />
            <p className="text-[10px] text-secondary"><span className="font-bold text-amber-400">{p.goal}</span> to beat your best week ({p.best_week})</p>
          </div>
        )}

        <MiniHeatmap cells={p.heatmap} label="Your contributions" />
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-purple-500" />
            <h3 className="text-[10px] font-semibold text-muted uppercase tracking-wider">All Activity</h3>
          </div>
          <span className="text-[10px] text-muted">{o.velocity_7d.toFixed(1)}/day</span>
        </div>

        <div className="space-y-1.5">
          {projs.map((pr, i) => (
            <div key={pr.id} className="flex items-center gap-2">
              <Circle size={8} className={cn('shrink-0 fill-current', PROJECT_DOT_COLORS[i % PROJECT_DOT_COLORS.length])} />
              <span className="text-[10px] font-mono text-muted w-8 shrink-0">{pr.prefix}</span>
              <div className="flex-1 h-2 rounded-full bg-surface-hover overflow-hidden">
                <div className={cn('h-full rounded-full', PROJECT_COLORS[i % PROJECT_COLORS.length])} style={{ width: `${(pr.actions_30d / projMax) * 100}%` }} />
              </div>
              <span className="text-[10px] font-semibold text-secondary tabular-nums w-6 text-right">{pr.actions_30d}</span>
            </div>
          ))}
        </div>

        {contributors.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {contributors.map(c => (
              <span key={c.user_id} className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border',
                c.is_agent ? 'bg-purple-500/10 border-purple-500/20 text-purple-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400',
              )}>
                {c.is_agent ? <Bot size={9} /> : <User size={9} />}
                {c.name} <span className="font-bold">{c.actions}</span>
              </span>
            ))}
          </div>
        )}

        <MiniHeatmap cells={o.heatmap} label="Team activity" />
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-semibold text-muted uppercase tracking-wider">Assigned to you</h3>
          {assigned.length > 0 && <span className="text-[10px] text-muted">{assigned.length} open</span>}
        </div>
        {assigned.length === 0 ? (
          <p className="text-[11px] text-muted py-1">No open issues assigned to you.</p>
        ) : (
          assigned.map(issue => (
            <button
              key={issue.id}
              onClick={() => onIssueClick(issue.display_id, issue.org_id)}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-surface-hover transition-colors text-left group"
            >
              <span className={cn('text-[10px]', PRIORITY_COLORS[issue.priority ?? 'medium'])}>●</span>
              <span className="text-[10px] font-mono text-muted shrink-0">{issue.display_id}</span>
              <span className="text-xs text-primary truncate flex-1 group-hover:text-amber-400 transition-colors">{issue.title}</span>
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full shrink-0', STATUS_BG[issue.status] ?? 'bg-gray-500/10 text-gray-400')}>
                {issue.status.replace('_', ' ')}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Project Table ─────────────────────────────────────

/**
 * Workflow order as used on the boards:
 * Draft → Backlog → In Progress → Not OK → In Review → Done → Cancelled
 * Grouped in three readable blocks: incoming load / active / outgoing.
 * Done + Cancelled are hidden by default (closed work is noise on a dashboard).
 */
const TABLE_STATUSES = [
  { key: 'todo', label: 'Draft', short: 'Draft', icon: PenLine, group: 'load' as const, hint: 'Brouillon — pas encore engagé', bar: 'bg-slate-500/35', text: 'text-muted' },
  { key: 'backlog', label: 'Backlog', short: 'Backlog', icon: Layers, group: 'load' as const, hint: 'Charge de travail à planifier', bar: 'bg-sky-400', text: 'text-sky-400' },
  { key: 'in_progress', label: 'In Progress', short: 'In prog.', icon: Clock, group: 'active' as const, hint: 'Travail en cours', bar: 'bg-amber-500', text: 'text-amber-500' },
  { key: 'not_ok', label: 'Not OK', short: 'Not OK', icon: AlertTriangle, group: 'active' as const, hint: 'Rejeté / à reprendre — priorité', bar: 'bg-red-500', text: 'text-red-500' },
  { key: 'in_review', label: 'In Review', short: 'Review', icon: Eye, group: 'out' as const, hint: 'En relecture / validation', bar: 'bg-purple-500', text: 'text-purple-400' },
  { key: 'done', label: 'Done', short: 'Done', icon: CheckCircle2, group: 'out' as const, hint: 'Terminé', bar: 'bg-emerald-500', text: 'text-emerald-500' },
  { key: 'cancelled', label: 'Cancelled', short: 'Cancel.', icon: XCircle, group: 'out' as const, hint: 'Annulé', bar: 'bg-slate-700', text: 'text-muted/70' },
];

type TableStatus = (typeof TABLE_STATUSES)[number];

/** Closed statuses — hidden by default, revealed by the "Terminés" toggle. */
const CLOSED_KEYS = ['done', 'cancelled'];

const GROUP_META: Record<'load' | 'active' | 'out', { label: string }> = {
  load: { label: 'Charge à venir' },
  active: { label: 'En cours' },
  out: { label: 'Sortie' },
};

/**
 * Per-status cell styling. Draft and Backlog used to be two near-identical
 * grays, unreadable side by side — Draft is now a dim outlined number,
 * Backlog a solid blue one.
 */
function StatusCell({ statusKey, value }: { statusKey: string; value: number }) {
  if (!value) return <span className="text-muted/25 select-none">·</span>;
  switch (statusKey) {
    case 'todo':
      return (
        <span className="inline-flex min-w-[22px] items-center justify-center rounded-md px-1.5 py-0.5 font-normal text-muted ring-1 ring-inset ring-border">
          {value}
        </span>
      );
    case 'backlog':
      return (
        <span className="inline-flex min-w-[22px] items-center justify-center rounded-md bg-sky-400/12 px-1.5 py-0.5 font-bold text-sky-400 ring-1 ring-inset ring-sky-400/25">
          {value}
        </span>
      );
    case 'in_progress':
      return <span className="font-semibold text-amber-500">{value}</span>;
    case 'not_ok':
      return (
        <span className="inline-flex min-w-[22px] items-center justify-center rounded-md bg-red-500/12 px-1.5 py-0.5 font-bold text-red-500 ring-1 ring-inset ring-red-500/25">
          {value}
        </span>
      );
    case 'in_review':
      return <span className="font-medium text-purple-400">{value}</span>;
    case 'done':
      return <span className="font-medium text-emerald-500">{value}</span>;
    case 'cancelled':
      return <span className="text-muted/60 line-through">{value}</span>;
    default:
      return <span className="text-secondary">{value}</span>;
  }
}

/**
 * Review wait cell — median days the project's `in_review` queue has been sitting.
 * Thresholds match the global Waiting-on-Client card: >14d red, >7d amber, else green.
 * `null` means the queue is empty, which is not "0 days" — render a dot, not a number.
 */
function ReviewCell({ days, stuck, count }: { days: number | null; stuck: number; count: number }) {
  if (days == null) return <span className="text-muted/25 select-none">·</span>;
  const rounded = days < 1 ? days.toFixed(1) : days.toFixed(0);
  const tone = days > 14 ? 'text-red-500' : days > 7 ? 'text-amber-500' : 'text-emerald-500';
  const title = stuck > 0
    ? `${count} en review · médiane ${rounded}j · ${stuck} au-delà de 14j`
    : `${count} en review · médiane ${rounded}j`;
  return (
    <span className={cn('font-semibold', tone)} title={title}>
      {rounded}j{stuck > 0 && <span className="ml-0.5 text-[9px] font-bold text-red-500">!</span>}
    </span>
  );
}

/** Stacked distribution bar — reads the whole project shape in one glance. */
function DistributionBar({ counts, statuses }: { counts: Record<string, number>; statuses: TableStatus[] }) {
  const total = statuses.reduce((sum, s) => sum + (counts[s.key] || 0), 0);
  if (total <= 0) return <div className="h-1.5 w-full rounded-full bg-surface-hover" />;
  const segments = statuses.filter(s => (counts[s.key] || 0) > 0);
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
      {segments.map(s => (
        <div
          key={s.key}
          className={s.bar}
          style={{ width: `${((counts[s.key] || 0) / total) * 100}%` }}
          title={`${s.label}: ${counts[s.key]}`}
        />
      ))}
    </div>
  );
}

type SortKey = 'name' | 'total' | 'pct' | 'ratio' | 'review' | string;

/**
 * Table prefs live in localStorage — the dashboard is a daily-driver screen,
 * re-picking sort + visibility on every visit is pure friction.
 */
const PREFS_KEY = 'baaton-dashboard-table-prefs';

interface TablePrefs {
  sortKey: SortKey;
  sortDesc: boolean;
  showClosed: boolean;
  showReview: boolean;
}

const DEFAULT_PREFS: TablePrefs = {
  sortKey: 'backlog',
  sortDesc: true,
  showClosed: false,
  showReview: true,
};

function loadPrefs(): TablePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<TablePrefs>;
    const sortKey = typeof parsed.sortKey === 'string' ? parsed.sortKey : DEFAULT_PREFS.sortKey;
    // Guard against a stale key from an older column set.
    const known = ['name', 'total', 'pct', 'ratio', 'review', ...TABLE_STATUSES.map(s => s.key)];
    return {
      sortKey: known.includes(sortKey) ? sortKey : DEFAULT_PREFS.sortKey,
      sortDesc: typeof parsed.sortDesc === 'boolean' ? parsed.sortDesc : DEFAULT_PREFS.sortDesc,
      showClosed: typeof parsed.showClosed === 'boolean' ? parsed.showClosed : DEFAULT_PREFS.showClosed,
      showReview: typeof parsed.showReview === 'boolean' ? parsed.showReview : DEFAULT_PREFS.showReview,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function ProjectTable({ orgs, onNavigate }: {
  orgs: DashboardOrg[];
  onNavigate: (project: DashboardProject, orgId: string) => void;
}) {
  const initialPrefs = useRef(loadPrefs()).current;
  const [sortKey, setSortKey] = useState<SortKey>(initialPrefs.sortKey);
  const [sortDesc, setSortDesc] = useState(initialPrefs.sortDesc);

  // Closed work (Done + Cancelled) is hidden by default — a dashboard is about
  // what is left to do. In Review is shown by default but can be folded away.
  const [showClosed, setShowClosed] = useState(initialPrefs.showClosed);
  const [showReview, setShowReview] = useState(initialPrefs.showReview);

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sortKey, sortDesc, showClosed, showReview }));
  }, [sortKey, sortDesc, showClosed, showReview]);

  const visibleStatuses = useMemo(
    () => TABLE_STATUSES.filter(s => {
      if (CLOSED_KEYS.includes(s.key)) return showClosed;
      if (s.key === 'in_review') return showReview;
      return true;
    }),
    [showClosed, showReview],
  );

  // A sort on a status that just got hidden would look broken — fall back.
  useEffect(() => {
    if (!visibleStatuses.some(s => s.key === sortKey) && TABLE_STATUSES.some(s => s.key === sortKey)) {
      setSortKey('backlog');
      setSortDesc(true);
    }
  }, [visibleStatuses, sortKey]);

  const rows = useMemo(() => {
    const flat = orgs.flatMap(org =>
      org.projects.map(project => {
        const counts = project.status_counts || {};
        const totalAll = project.total_issues || 0;
        const done = counts.done || 0;
        const created = project.created_this_month || 0;
        const closed = project.closed_this_month || 0;
        // "Total" follows what is on screen, otherwise the row doesn't add up.
        const total = visibleStatuses.reduce((sum, s) => sum + (counts[s.key] || 0), 0);
        return {
          project, org, counts, total, totalAll, done, created, closed,
          lastActivity: project.last_activity_at ? Date.parse(project.last_activity_at) : 0,
          reviewDays: project.review_median_days,
          reviewStuck: project.review_stuck || 0,
          pct: totalAll > 0 ? Math.round((done / totalAll) * 100) : 0,
          ratio: created > 0 ? closed / created : closed > 0 ? 99 : 0,
        };
      }),
    );
    const dir = sortDesc ? -1 : 1;
    return flat.sort((a, b) => {
      if (sortKey === 'name') return a.project.name.localeCompare(b.project.name) * dir;
      // Projects with an empty review queue have no wait to compare — keep them at the
      // bottom in both directions instead of letting a fake 0 win the "longest wait" sort.
      if (sortKey === 'review') {
        if (a.reviewDays == null && b.reviewDays == null) return a.project.name.localeCompare(b.project.name);
        if (a.reviewDays == null) return 1;
        if (b.reviewDays == null) return -1;
        if (a.reviewDays === b.reviewDays) return b.lastActivity - a.lastActivity;
        return (a.reviewDays - b.reviewDays) * dir;
      }
      const va = sortKey === 'total' ? a.total : sortKey === 'pct' ? a.pct : sortKey === 'ratio' ? a.ratio : (a.counts[sortKey] || 0);
      const vb = sortKey === 'total' ? b.total : sortKey === 'pct' ? b.pct : sortKey === 'ratio' ? b.ratio : (b.counts[sortKey] || 0);
      // Ties are common: most projects show the same small count in a given column.
      // Alphabetical order there is noise, so fall back to most recent issue activity
      // (independent of sort direction) and only use the name as a last resort.
      if (va === vb) {
        if (a.lastActivity !== b.lastActivity) return b.lastActivity - a.lastActivity;
        return a.project.name.localeCompare(b.project.name);
      }
      return (va - vb) * dir;
    });
  }, [orgs, sortKey, sortDesc, visibleStatuses]);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDesc(d => !d);
        return prev;
      }
      setSortDesc(key !== 'name');
      return key;
    });
  }, []);

  const totals = useMemo(() => {
    const acc: Record<string, number> = { total: 0 };
    for (const r of rows) {
      acc.total += r.total;
      for (const s of TABLE_STATUSES) acc[s.key] = (acc[s.key] || 0) + (r.counts[s.key] || 0);
    }
    return acc;
  }, [rows]);

  const hiddenCount = useMemo(() => {
    let n = 0;
    if (!showClosed) n += (totals.done || 0) + (totals.cancelled || 0);
    if (!showReview) n += totals.in_review || 0;
    return n;
  }, [showClosed, showReview, totals]);

  const SortArrow = ({ active }: { active: boolean }) =>
    !active ? null : sortDesc
      ? <ChevronDown size={9} className="inline ml-0.5 -mt-px" />
      : <ChevronUp size={9} className="inline ml-0.5 -mt-px" />;

  const MOBILE_SORTS: Array<{ key: SortKey; label: string }> = [
    { key: 'backlog', label: 'Backlog' },
    { key: 'not_ok', label: 'Not OK' },
    { key: 'in_progress', label: 'In prog.' },
    { key: 'review', label: 'Review' },
    { key: 'total', label: 'Total' },
    { key: 'name', label: 'A-Z' },
  ];

  /** Shared visibility toggles — same control on mobile and desktop. */
  const VisibilityToggles = ({ className }: { className?: string }) => (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        onClick={() => setShowReview(v => !v)}
        title={showReview ? 'Masquer les In Review' : 'Afficher les In Review'}
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors',
          showReview
            ? 'border-purple-500/30 bg-purple-500/10 text-purple-400'
            : 'border-border text-muted hover:text-secondary',
        )}
      >
        {showReview ? <Eye size={10} /> : <EyeOff size={10} />}
        Review
        {(totals.in_review || 0) > 0 && <span className="tabular-nums opacity-70">{totals.in_review}</span>}
      </button>
      <button
        onClick={() => setShowClosed(v => !v)}
        title={showClosed ? 'Masquer Done + Cancelled' : 'Afficher Done + Cancelled'}
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition-colors',
          showClosed
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
            : 'border-border text-muted hover:text-secondary',
        )}
      >
        {showClosed ? <Eye size={10} /> : <EyeOff size={10} />}
        Terminés
        {(totals.done || 0) + (totals.cancelled || 0) > 0 && (
          <span className="tabular-nums opacity-70">{(totals.done || 0) + (totals.cancelled || 0)}</span>
        )}
      </button>
    </div>
  );

  const visibleGroups = useMemo(
    () => (['load', 'active', 'out'] as const)
      .map(g => ({ g, span: visibleStatuses.filter(s => s.group === g).length }))
      .filter(x => x.span > 0),
    [visibleStatuses],
  );

  return (
    <div className="rounded-xl border border-border bg-surface">
      {/* ── Mobile: dense list, no horizontal scroll ── */}
      <div className="md:hidden">
        <div className="border-b border-border px-2 py-2">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            <span className="shrink-0 pr-1 text-[9px] font-semibold uppercase tracking-wider text-muted">Tri</span>
            {MOBILE_SORTS.map(o => {
              const active = sortKey === o.key;
              return (
                <button
                  key={o.key}
                  onClick={() => toggleSort(o.key)}
                  className={cn(
                    'shrink-0 rounded-full px-2 py-1 text-[10px] font-medium transition-colors',
                    active ? 'bg-surface-hover text-primary' : 'text-muted',
                  )}
                >
                  {o.label}
                  {active && (sortDesc ? <ChevronDown size={9} className="inline ml-0.5 -mt-px" /> : <ChevronUp size={9} className="inline ml-0.5 -mt-px" />)}
                </button>
              );
            })}
          </div>
          <VisibilityToggles className="mt-1.5 overflow-x-auto no-scrollbar" />
        </div>

        <div className="divide-y divide-border/20">
          {rows.map(r => {
            const notOk = r.counts.not_ok || 0;
            const chips = visibleStatuses.filter(s => (r.counts[s.key] || 0) > 0);
            return (
              <button
                key={r.project.id}
                onClick={() => onNavigate(r.project, r.org.id)}
                className={cn(
                  'block w-full px-3 py-2.5 text-left active:bg-surface-hover/60',
                  notOk > 0 && 'border-l-2 border-red-500 bg-red-500/[0.03]',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 rounded bg-surface-hover px-1 py-0.5 font-mono text-[9px] text-muted">{r.project.prefix}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-primary">{r.project.name}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted">{r.total} · {r.pct}%</span>
                </div>

                <div className="mt-1.5"><DistributionBar counts={r.counts} statuses={visibleStatuses} /></div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  {chips.length === 0
                    ? <span className="text-[10px] text-muted/40">Rien à traiter</span>
                    : chips.map(s => (
                      <span key={s.key} className="flex items-center gap-1 text-[10px]">
                        <s.icon size={10} className={s.text} />
                        <span className={cn('font-semibold tabular-nums', s.text)}>{r.counts[s.key]}</span>
                        <span className="text-muted/70">{s.short}</span>
                      </span>
                    ))}
                  {(r.created > 0 || r.closed > 0) && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-muted/70">
                      30j
                      <span className={cn('font-semibold', r.ratio >= 1 ? 'text-emerald-500' : 'text-amber-500')}>
                        {r.ratio >= 1 ? '↑' : '↓'}{r.ratio >= 99 ? '∞' : r.ratio.toFixed(1)}
                      </span>
                    </span>
                  )}
                  {r.reviewDays != null && (
                    <span className={cn('flex items-center gap-1 text-[10px] text-muted/70', !(r.created > 0 || r.closed > 0) && 'ml-auto')}>
                      review
                      <ReviewCell days={r.reviewDays} stuck={r.reviewStuck} count={r.counts.in_review || 0} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-x-2 border-t border-border/40 px-3 py-2 text-[10px] text-muted">
          <span>{rows.length} projets</span>
          <span className="text-muted/40">·</span>
          <span><span className="font-semibold text-primary tabular-nums">{totals.total}</span> tickets</span>
          {hiddenCount > 0 && <span className="text-muted/50">({hiddenCount} masqués)</span>}
          {(totals.not_ok || 0) > 0 && (
            <span className="ml-auto flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              <span className="font-bold text-red-500 tabular-nums">{totals.not_ok}</span> Not OK
            </span>
          )}
        </div>
      </div>

      {/* ── Desktop: full workflow table ── */}
      <div className="hidden items-center justify-between gap-3 border-b border-border/40 px-3 py-2 md:flex">
        <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted">
          Workflow · {rows.length} projets
          {hiddenCount > 0 && <span className="ml-1 text-muted/50">({hiddenCount} tickets masqués)</span>}
        </span>
        <VisibilityToggles />
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            {/* Group band */}
            <tr>
              <th className="sticky left-0 z-20 bg-surface border-b border-border/40 px-3 py-1.5 text-left" />
              {visibleGroups.map(({ g, span }) => (
                <th
                  key={g}
                  colSpan={span}
                  className={cn(
                    'border-b border-l border-border/40 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em]',
                    g === 'load' && 'text-muted',
                    g === 'active' && 'text-amber-500/80',
                    g === 'out' && 'text-emerald-500/80',
                  )}
                >
                  {GROUP_META[g].label}
                </th>
              ))}
              <th colSpan={2} className="border-b border-l border-border/40 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted">
                Flux 30j
              </th>
              <th colSpan={2} className="border-b border-l border-border/40 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted">
                Volume
              </th>
            </tr>
            {/* Column labels — text, not icons only */}
            <tr className="bg-surface-hover/40">
              <th
                onClick={() => toggleSort('name')}
                className="sticky left-0 z-20 cursor-pointer select-none border-b border-border bg-surface-hover/95 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-secondary backdrop-blur"
              >
                Projet<SortArrow active={sortKey === 'name'} />
              </th>
              {visibleStatuses.map((s, i) => {
                const isGroupStart = i === 0 || visibleStatuses[i - 1].group !== s.group;
                const Icon = s.icon;
                const active = sortKey === s.key;
                return (
                  <th
                    key={s.key}
                    title={s.hint}
                    onClick={() => toggleSort(s.key)}
                    className={cn(
                      'cursor-pointer select-none border-b border-border px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap',
                      isGroupStart && 'border-l border-border/40',
                      s.key === 'not_ok' ? 'text-red-500' : s.key === 'backlog' ? 'text-sky-400' : 'text-muted',
                      active && 'text-primary',
                      'hover:text-secondary',
                    )}
                  >
                    <Icon size={9} className="inline mr-1 -mt-px" />
                    {s.short}
                    <SortArrow active={active} />
                  </th>
                );
              })}
              <th title="Créées sur 30 jours" className="border-b border-l border-border/40 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted">In</th>
              <th title="Ratio sorties/entrées — ≥1 = tu absorbes la charge" onClick={() => toggleSort('ratio')} className={cn('cursor-pointer select-none border-b border-border px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide hover:text-secondary', sortKey === 'ratio' ? 'text-primary' : 'text-muted')}>
                Flow<SortArrow active={sortKey === 'ratio'} />
              </th>
              <th title="Attente médiane en review (jours) — temps côté client, pas temps de dev" onClick={() => toggleSort('review')} className={cn('cursor-pointer select-none border-b border-border px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide hover:text-secondary', sortKey === 'review' ? 'text-primary' : 'text-muted')}>
                Review<SortArrow active={sortKey === 'review'} />
              </th>
              <th onClick={() => toggleSort('total')} className={cn('cursor-pointer select-none border-b border-l border-border/40 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide hover:text-secondary', sortKey === 'total' ? 'text-primary' : 'text-muted')}>
                Total<SortArrow active={sortKey === 'total'} />
              </th>
              <th onClick={() => toggleSort('pct')} className={cn('cursor-pointer select-none border-b border-border px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide hover:text-secondary', sortKey === 'pct' ? 'text-primary' : 'text-muted')}>
                Répartition<SortArrow active={sortKey === 'pct'} />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.project.id}
                onClick={() => onNavigate(r.project, r.org.id)}
                className="group cursor-pointer border-b border-border/20 hover:bg-surface-hover/60"
              >
                <td className="sticky left-0 z-10 border-b border-border/20 bg-surface px-3 py-2.5 transition-colors group-hover:bg-surface-hover/60">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-muted">{r.project.prefix}</span>
                    <span className="truncate max-w-[150px] font-medium text-primary group-hover:text-accent">{r.project.name}</span>
                    <span className="hidden truncate max-w-[70px] text-[9px] text-muted/60 md:inline">{r.org.name}</span>
                  </div>
                </td>
                {visibleStatuses.map((s, i) => {
                  const isGroupStart = i === 0 || visibleStatuses[i - 1].group !== s.group;
                  return (
                    <td
                      key={s.key}
                      className={cn(
                        'border-b border-border/20 px-2 py-2.5 text-center tabular-nums',
                        isGroupStart && 'border-l border-border/30',
                        s.key === 'not_ok' && (r.counts.not_ok || 0) > 0 && 'bg-red-500/[0.04]',
                      )}
                    >
                      <StatusCell statusKey={s.key} value={r.counts[s.key] || 0} />
                    </td>
                  );
                })}
                <td className="border-b border-l border-border/30 px-2 py-2.5 text-center tabular-nums">
                  {r.created > 0 ? <span className="text-blue-400">{r.created}</span> : <span className="text-muted/25">·</span>}
                </td>
                <td className="border-b border-border/20 px-2 py-2.5 text-center tabular-nums">
                  {r.created === 0 && r.closed === 0
                    ? <span className="text-muted/25">·</span>
                    : r.ratio >= 1
                      ? <span className="font-semibold text-emerald-500" title={`${r.closed} fermées / ${r.created} créées`}>↑{r.ratio >= 99 ? '∞' : r.ratio.toFixed(1)}</span>
                      : <span className="font-semibold text-amber-500" title={`${r.closed} fermées / ${r.created} créées — la dette grossit`}>↓{r.ratio.toFixed(1)}</span>}
                </td>
                <td className={cn('border-b border-border/20 px-2 py-2.5 text-center tabular-nums', r.reviewDays != null && r.reviewDays > 14 && 'bg-red-500/[0.04]')}>
                  <ReviewCell days={r.reviewDays} stuck={r.reviewStuck} count={r.counts.in_review || 0} />
                </td>
                <td className="border-b border-l border-border/30 px-2 py-2.5 text-center font-semibold tabular-nums text-primary">{r.total}</td>
                <td className="border-b border-border/20 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <DistributionBar counts={r.counts} statuses={visibleStatuses} />
                    <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted">{r.pct}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-hover/30">
              <td className="sticky left-0 z-10 bg-surface-hover/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted backdrop-blur">
                {rows.length} projets
              </td>
              {visibleStatuses.map((s, i) => {
                const isGroupStart = i === 0 || visibleStatuses[i - 1].group !== s.group;
                return (
                  <td key={s.key} className={cn('px-2 py-2 text-center text-[11px] tabular-nums', isGroupStart && 'border-l border-border/30', s.key === 'not_ok' ? 'font-bold text-red-500' : s.key === 'backlog' ? 'font-bold text-primary' : 'text-muted')}>
                    {totals[s.key] || 0}
                  </td>
                );
              })}
              <td className="border-l border-border/30 px-2 py-2" />
              <td className="px-2 py-2" />
              <td className="px-2 py-2" />
              <td className="border-l border-border/30 px-2 py-2 text-center text-[11px] font-semibold tabular-nums text-primary">{totals.total}</td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
      {/* Legend — the icon-only header was unreadable without it */}
      <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 px-3 py-2 text-[9px] text-muted md:flex">
        <span className="font-semibold uppercase tracking-wider">Workflow</span>
        {TABLE_STATUSES.map((s, i) => {
          const hidden = !visibleStatuses.some(v => v.key === s.key);
          return (
            <span key={s.key} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted/40">→</span>}
              <span className={cn(
                hidden && 'text-muted/30 line-through',
                !hidden && s.key === 'not_ok' && 'font-semibold text-red-500',
                !hidden && s.key === 'backlog' && 'font-semibold text-sky-400',
              )}>{s.label}</span>
            </span>
          );
        })}
        <span className="ml-auto">Clique un en-tête pour trier</span>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { organization: activeOrg } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({ userMemberships: { infinite: true } });
  const apiClient = useApi();
  const memberships = userMemberships?.data ?? [];

  // Stable query key — backend is cross-org, no need to re-fetch on org switch
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: async () => {
      const res = await apiClient.get<DashboardSummary>('/dashboard/summary');
      return res;
    },
    enabled: memberships.length > 0,
    staleTime: 30_000,
  });

  const metricsItems = useMemo(() => {
    const active = data?.metrics.active_issues ?? 0;
    const created = data?.metrics.issues_created?.reduce((sum, row) => sum + row.count, 0) ?? 0;
    const closed = data?.metrics.issues_closed?.reduce((sum, row) => sum + row.count, 0) ?? 0;

    // Client review queue. Replaces the old "Avg Resolution" card, which averaged a
    // long-tailed distribution (one issue sat 190 days) and read ~3x the median, so it
    // never matched what the board looked like. Median + a count of issues past 14 days
    // answers the only question this card needs to answer: is the client blocking us,
    // and on how many tickets?
    const wait = data?.metrics.client_wait;
    const waitValue = wait?.median_days != null ? `${wait.median_days.toFixed(0)}d` : '—';
    const waitSub = wait
      ? wait.stuck > 0
        ? `${wait.stuck} over 14d · ${wait.waiting} in review`
        : `${wait.waiting} in review`
      : undefined;
    // Amber past a week of typical wait, red past two: the queue is the bottleneck.
    const waitColor =
      wait?.median_days == null ? '#8b5cf6' : wait.median_days > 14 ? '#ef4444' : wait.median_days > 7 ? '#f59e0b' : '#22c55e';

    return [
      { label: 'Active Issues', value: active, color: '#3b82f6', icon: TrendingUp, sub: `+${created} last 30d` },
      { label: 'Created', value: created, color: '#f59e0b', icon: Zap, sub: 'Last 30 days' },
      { label: 'Closed', value: closed, color: '#22c55e', icon: CheckCircle2, sub: closed > created ? 'On track' : undefined },
      { label: 'Waiting on Client', value: waitValue, color: waitColor, icon: Timer, sub: waitSub },
    ];
  }, [data]);

  const pendingNavRef = useRef<string | null>(null);
  // Pending navigation refs — used to complete navigation after org switch
  const pendingIssueNavRef = useRef<string | null>(null);

  // Project view mode (cards vs table)
  const [projectViewMode, setProjectViewMode] = useState<'cards' | 'table'>(() => {
    const saved = localStorage.getItem('baaton-dashboard-view');
    return saved === 'cards' ? 'cards' : 'table';
  });
  useEffect(() => {
    localStorage.setItem('baaton-dashboard-view', projectViewMode);
  }, [projectViewMode]);

  useEffect(() => {
    if (pendingNavRef.current && activeOrg) {
      const target = pendingNavRef.current;
      pendingNavRef.current = null;
      navigate(`/projects/${target}`);
    }
    if (pendingIssueNavRef.current && activeOrg) {
      const displayId = pendingIssueNavRef.current;
      pendingIssueNavRef.current = null;
      navigate(`/all-issues?issue=${displayId}`);
    }
  }, [activeOrg, navigate]);

  // Navigate to an issue — switches org first if needed
  const handleIssueNavigate = useCallback((displayId: string, orgId: string | null) => {
    if (!orgId || orgId === activeOrg?.id) {
      navigate(`/all-issues?issue=${displayId}`);
    } else {
      pendingIssueNavRef.current = displayId;
      setActive?.({ organization: orgId });
    }
  }, [activeOrg?.id, navigate, setActive]);

  const handleProjectNavigate = useCallback((project: DashboardProject, orgId: string) => {
    if (orgId === activeOrg?.id) {
      navigate(`/projects/${project.slug}`);
    } else {
      pendingNavRef.current = project.slug;
      setActive?.({ organization: orgId });
    }
  }, [activeOrg?.id, navigate, setActive]);

  const sortedOrgs = useMemo(() => {
    const orgs = data?.orgs ?? [];
    return [...orgs].sort((a, b) => {
      if (a.id === activeOrg?.id) return -1;
      if (b.id === activeOrg?.id) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [data?.orgs, activeOrg?.id]);

  const totalProjects = data?.orgs.reduce((sum, org) => sum + org.projects.length, 0) ?? 0;

  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-6 md:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-primary">{getGreeting()}</h1>
        <p className="text-secondary mt-1">
          {(data?.orgs.length ?? memberships.length) > 1
            ? `${totalProjects} projects across ${data?.orgs.length ?? memberships.length} organizations.`
            : `${totalProjects} projects in your workspace.`}
        </p>
      </div>

      <div className="mb-6">
        <MetricsBar items={metricsItems} />
      </div>

      {data?.metrics && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[10px] font-semibold text-muted uppercase tracking-wider">Activity — 30 days</h2>
            <span className="text-[10px] text-muted">
              {data.metrics.issues_created.reduce((s, p) => s + p.count, 0)} created · {data.metrics.issues_closed.reduce((s, p) => s + p.count, 0)} closed
            </span>
          </div>
          <ActivityChart created={data.metrics.issues_created} closed={data.metrics.issues_closed} />
        </div>
      )}

      <div className="mb-6"><GlobalCreateIssueButton variant="big" /></div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-[10px] font-semibold text-muted uppercase tracking-wider">{t('dashboard.projects')}</h2>
              <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
                <button
                  onClick={() => setProjectViewMode('cards')}
                  className={cn(
                    'rounded-[5px] p-1.5 transition-colors',
                    projectViewMode === 'cards' ? 'bg-surface-hover text-primary' : 'text-muted hover:text-secondary',
                  )}
                  title="Cards"
                >
                  <LayoutGrid size={14} />
                </button>
                <button
                  onClick={() => setProjectViewMode('table')}
                  className={cn(
                    'rounded-[5px] p-1.5 transition-colors',
                    projectViewMode === 'table' ? 'bg-surface-hover text-primary' : 'text-muted hover:text-secondary',
                  )}
                  title="Table"
                >
                  <Table2 size={14} />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/all-issues" className="text-[10px] text-secondary hover:text-accent transition-colors">All issues →</Link>
              <Link to="/projects" className="text-[10px] text-accent hover:text-accent-hover transition-colors">{t('dashboard.viewAll')} →</Link>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-surface p-5 space-y-3 animate-pulse">
                  <div className="flex items-center gap-2.5"><div className="h-8 w-8 rounded-lg bg-surface-hover" /><div className="h-4 w-24 rounded bg-surface-hover" /></div>
                  <div className="space-y-2">{[...Array(3)].map((_, j) => <div key={j} className="h-4 rounded bg-surface-hover" />)}</div>
                </div>
              ))}
            </div>
          ) : sortedOrgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-border bg-surface">
              <Kanban size={32} className="text-secondary mb-2" />
              <p className="text-sm text-secondary">{t('dashboard.noProjects')}</p>
            </div>
          ) : projectViewMode === 'table' ? (
            <ProjectTable orgs={sortedOrgs} onNavigate={handleProjectNavigate} />
          ) : (
            sortedOrgs.map(org => (
              <OrgSection
                key={org.id}
                org={org}
                onSwitch={org.id !== activeOrg?.id ? () => setActive?.({ organization: org.id }) : undefined}
                onProjectNavigate={handleProjectNavigate}
              />
            ))
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-3">{t('dashboard.recentActivity')}</h2>
            <ActivityFeed limit={15} entries={data ? data.recent_activity : null} onIssueClick={handleIssueNavigate} />
          </div>

          {data && <GamificationPanel data={data} onIssueClick={handleIssueNavigate} />}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
