import { useOrganizationList, useOrganization } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import {
  Kanban, ArrowRight, Clock, Circle, Eye,
  CheckCircle2, Building2, ChevronRight,
  TrendingUp, Zap, Timer, Flame, Bot, User, Target,
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
    { key: 'backlog', label: 'Backlog', icon: Circle, color: 'text-muted' },
    { key: 'todo', label: 'Todo', icon: Circle, color: 'text-blue-500' },
    { key: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-amber-500' },
    { key: 'in_review', label: 'Review', icon: Eye, color: 'text-purple-500' },
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
const STATUS_BG: Record<string, string> = { backlog: 'bg-gray-500/10 text-gray-400', todo: 'bg-blue-500/10 text-blue-400', in_progress: 'bg-amber-500/10 text-amber-400', in_review: 'bg-purple-500/10 text-purple-400' };

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
    const avgH = data?.metrics.avg_resolution_hours;
    const avgLabel = avgH != null ? (avgH >= 24 ? `${(avgH / 24).toFixed(1)}` : `${avgH.toFixed(1)}h`) : '—';
    const avgSub = avgH != null ? (avgH >= 24 ? 'days' : '') : '';
    return [
      { label: 'Active Issues', value: active, color: '#3b82f6', icon: TrendingUp, sub: `+${created} last 30d` },
      { label: 'Created', value: created, color: '#f59e0b', icon: Zap, sub: 'Last 30 days' },
      { label: 'Closed', value: closed, color: '#22c55e', icon: CheckCircle2, sub: closed > created ? 'On track' : undefined },
      { label: 'Avg Resolution', value: avgLabel, color: '#8b5cf6', icon: Timer, sub: avgSub || undefined },
    ];
  }, [data]);

  const pendingNavRef = useRef<string | null>(null);
  // Pending navigation refs — used to complete navigation after org switch
  const pendingIssueNavRef = useRef<string | null>(null);

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
            <h2 className="text-[10px] font-semibold text-muted uppercase tracking-wider">{t('dashboard.projects')}</h2>
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
          {data && <GamificationPanel data={data} onIssueClick={handleIssueNavigate} />}

          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-3">{t('dashboard.recentActivity')}</h2>
            <ActivityFeed limit={15} entries={data ? data.recent_activity : null} onIssueClick={handleIssueNavigate} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
