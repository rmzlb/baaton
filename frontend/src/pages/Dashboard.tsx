import { useAuth } from '@clerk/clerk-react';
import { useOrganizationList, useOrganization } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api';
import {
  Kanban, ArrowRight, Archive, Clock, Circle, Eye,
  CheckCircle2, OctagonAlert, Building2, ChevronRight,
  TrendingUp, Zap, Timer, Flame, Bot, User, Target,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { GlobalCreateIssueButton } from '@/components/issues/GlobalCreateIssue';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { cn } from '@/lib/utils';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import type { Issue, Project, HeatmapCell } from '@/lib/types';

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

// ─── Status bar (thin) ─────────────────────────────────

function StatusBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (total === 0) return <div className="h-1.5 rounded-full bg-surface-hover" />;
  const colors: Record<string, string> = { done: '#22c55e', in_review: '#8b5cf6', in_progress: '#f59e0b', todo: '#3b82f6', backlog: '#6b7280' };
  const segments = ['done', 'in_review', 'in_progress', 'todo', 'backlog'].filter(s => (counts[s] || 0) > 0);
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden bg-surface-hover">
      {segments.map(s => <div key={s} className="h-full" style={{ width: `${((counts[s] || 0) / total) * 100}%`, backgroundColor: colors[s] }} />)}
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

function ProjectCard({ project, issues, onNavigate }: {
  project: Project; issues: Issue[]; onNavigate: () => void;
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of issues) c[i.status] = (c[i.status] || 0) + 1;
    return c;
  }, [issues]);

  const total = issues.length;
  const done = counts['done'] || 0;

  // Unique assignees for avatar stack
  const assignees = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of issues) {
      if (i.assignee_ids) {
        for (const aid of i.assignee_ids) {
          if (aid && !seen.has(aid)) seen.set(aid, aid);
        }
      }
    }
    return Array.from(seen.keys()).slice(0, 4);
  }, [issues]);

  const statusRows = [
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
      {/* Header */}
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

      {/* Clean data list — dimmed when zero */}
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

      {/* Footer: avatar stack + done badge */}
      <div className="flex items-center justify-between pt-4 border-t border-border/50 mt-auto">
        {/* Avatar stack */}
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

        {/* Done badge */}
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

// ─── Org Section ───────────────────────────────────────

function OrgSection({ orgName, orgSlug, orgImageUrl, projects, issuesByProject, isCurrentOrg, onSwitch, onProjectNavigate }: {
  orgName: string; orgSlug: string; orgImageUrl?: string | null;
  projects: Project[]; issuesByProject: Record<string, Issue[]>;
  isCurrentOrg: boolean; onSwitch?: () => void;
  onProjectNavigate: (project: Project) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const allIssues = projects.flatMap(p => issuesByProject[p.id] || []);
  const totalActive = allIssues.filter(i => !['done', 'cancelled'].includes(i.status)).length;

  return (
    <div className="mb-6">
      <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2.5 mb-3 group w-full text-left">
        <ChevronRight size={14} className={cn('text-muted transition-transform', !collapsed && 'rotate-90')} />
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-hover shrink-0 overflow-hidden">
          {orgImageUrl
            ? <img src={orgImageUrl} alt="" className="h-5 w-5 object-contain" />
            : <Building2 size={12} className="text-accent" />
          }
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold text-primary truncate">{orgName}</span>
          {isCurrentOrg && (
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-semibold text-accent uppercase tracking-wider">Active</span>
          )}
          <span className="text-[10px] text-muted font-mono shrink-0">
            {projects.length} proj · {totalActive} active / {allIssues.length}
          </span>
        </div>
        <Link to={`/all-issues?org=${encodeURIComponent(orgSlug)}`} onClick={e => e.stopPropagation()} className="shrink-0 text-[10px] text-secondary hover:text-accent transition-colors">
          All issues →
        </Link>
        {!isCurrentOrg && onSwitch && (
          <button onClick={e => { e.stopPropagation(); onSwitch(); }} className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-secondary hover:text-primary transition-colors">
            Switch
          </button>
        )}
      </button>
      {!collapsed && (
        projects.length === 0
          ? <div className="rounded-xl border border-border/50 bg-surface/50 p-6 text-center text-sm text-muted">No projects yet</div>
          : <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{projects.map(p => (
              <ProjectCard key={p.id} project={p} issues={issuesByProject[p.id] || []} onNavigate={() => onProjectNavigate(p)} />
            ))}</div>
      )}
    </div>
  );
}

// ─── Mini Heatmap ──────────────────────────────────────

function MiniHeatmap({ cells, label }: { cells: HeatmapCell[]; label: string }) {
  const countMap = new Map(cells.map(c => [c.date, c.count]));
  const today = new Date();
  const dates: Date[] = [];
  for (let i = 89; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); dates.push(d); }

  const weeks: { date: Date; count: number }[][] = [];
  let cw: { date: Date; count: number }[] = [];
  for (const d of dates) {
    const dow = d.getDay();
    const mi = dow === 0 ? 6 : dow - 1;
    if (mi === 0 && cw.length > 0) { weeks.push(cw); cw = []; }
    cw.push({ date: d, count: countMap.get(d.toISOString().slice(0, 10)) ?? 0 });
  }
  if (cw.length > 0) weeks.push(cw);

  const max = Math.max(...cells.map(c => c.count), 1);
  const lvl = (n: number) => n === 0 ? 0 : n <= max * 0.25 ? 1 : n <= max * 0.5 ? 2 : n <= max * 0.75 ? 3 : 4;
  const colors = ['bg-border/50', 'bg-amber-500/25', 'bg-amber-500/45', 'bg-amber-500/70', 'bg-amber-500'];

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</p>
      <div className="overflow-x-auto no-scrollbar">
        <div className="flex gap-[2px]">
          {weeks.map((w, wi) => (
            <div key={wi} className="flex flex-col gap-[2px]">
              {wi === 0 && Array.from({ length: 7 - w.length }).map((_, pi) => <div key={pi} className="w-[8px] h-[8px]" />)}
              {w.map((d, di) => (
                <div key={di} title={`${d.date.toISOString().slice(0, 10)}: ${d.count}`} className={cn('w-[8px] h-[8px] rounded-[1px]', colors[lvl(d.count)])} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Gamification Panel (right column) ─────────────────

interface DashboardGamification {
  personal: { velocity_7d: number; velocity_30d: number; velocity_trend: string; this_week: number; today: number; streak: number; best_week: number; goal: number | null; breakdown: Record<string, number>; heatmap: HeatmapCell[] };
  org: { velocity_7d: number; this_week: number; today: number; breakdown: Record<string, number>; heatmap: HeatmapCell[] };
  projects: Array<{ id: string; name: string; prefix: string; actions_30d: number }>;
  contributors: Array<{ user_id: string; name: string; actions: number; is_agent: boolean }>;
  assigned: Array<{ id: string; display_id: string; title: string; status: string; priority: string | null; project_prefix: string }>;
}

const PROJECT_COLORS = ['bg-amber-500', 'bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-rose-500', 'bg-cyan-500'];
const PROJECT_DOT_COLORS = ['text-amber-500', 'text-emerald-500', 'text-blue-500', 'text-purple-500', 'text-rose-500', 'text-cyan-500'];
const PRIORITY_COLORS: Record<string, string> = { urgent: 'text-red-500', high: 'text-orange-500', medium: 'text-amber-500', low: 'text-blue-400' };
const STATUS_BG: Record<string, string> = { backlog: 'bg-gray-500/10 text-gray-400', todo: 'bg-blue-500/10 text-blue-400', in_progress: 'bg-amber-500/10 text-amber-400', in_review: 'bg-purple-500/10 text-purple-400' };

function GamificationPanel() {
  const { getToken } = useAuth();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['gamification-dashboard'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) return null;
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://api.baaton.dev'}/api/v1/gamification/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      return json.data as DashboardGamification;
    },
    staleTime: 60_000,
  });

  if (!data) return null;
  const { personal: p, org: o, projects: projs, contributors, assigned } = data;
  const projMax = Math.max(...projs.map(pr => pr.actions_30d), 1);

  return (
    <div className="space-y-4">
      {/* ── Your Activity ── */}
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

        {/* Stats row */}
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

        {/* Goal */}
        {p.goal != null && p.goal > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-1.5">
            <Target size={12} className="text-amber-500" />
            <p className="text-[10px] text-secondary"><span className="font-bold text-amber-400">{p.goal}</span> to beat your best week ({p.best_week})</p>
          </div>
        )}

        <MiniHeatmap cells={p.heatmap} label="Your contributions" />
      </div>

      {/* ── All Projects Activity ── */}
      <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-purple-500" />
            <h3 className="text-[10px] font-semibold text-muted uppercase tracking-wider">All Activity</h3>
          </div>
          <span className="text-[10px] text-muted">{o.velocity_7d.toFixed(1)}/day</span>
        </div>

        {/* Per-project bars */}
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

        {/* Contributors chips */}
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

      {/* ── Assigned to You ── */}
      {assigned.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold text-muted uppercase tracking-wider">Assigned to you</h3>
            <span className="text-[10px] text-muted">{assigned.length} open</span>
          </div>
          {assigned.map(issue => (
            <button
              key={issue.id}
              onClick={() => navigate(`/all-issues?issue=${issue.display_id}`)}
              className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-surface-hover transition-colors text-left group"
            >
              <span className={cn('text-[10px]', PRIORITY_COLORS[issue.priority ?? 'medium'])}>●</span>
              <span className="text-[10px] font-mono text-muted shrink-0">{issue.display_id}</span>
              <span className="text-xs text-primary truncate flex-1 group-hover:text-amber-400 transition-colors">{issue.title}</span>
              <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full shrink-0', STATUS_BG[issue.status] ?? 'bg-gray-500/10 text-gray-400')}>
                {issue.status.replace('_', ' ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Dashboard — main page
// ═══════════════════════════════════════════════════════

export function Dashboard() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const { organization: activeOrg } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({ userMemberships: { infinite: true } });
  const apiClient = useApi();
  const memberships = userMemberships?.data ?? [];

  const { data: orgData = [], isLoading } = useQuery({
    queryKey: ['dashboard-cross-org', memberships.map(m => m.organization.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        memberships.map(async m => {
          const org = m.organization;
          try {
            const token = await getToken({ organizationId: org.id });
            if (!token) return { org, projects: [] as Project[], issues: [] as Issue[] };
            const projects = await api.get<Project[]>('/projects', token);
            const issues = await api.get<Issue[]>('/issues?limit=2000', token);
            return { org, projects, issues };
          } catch { return { org, projects: [] as Project[], issues: [] as Issue[] }; }
        }),
      );
      return results;
    },
    enabled: memberships.length > 0,
    staleTime: 30_000,
  });

  const { data: metrics } = useQuery({
    queryKey: ['metrics', activeOrg?.id],
    queryFn: () => apiClient.metrics.get(30),
    enabled: !!activeOrg,
    staleTime: 60_000,
  });

  const issuesByProject = useMemo(() => {
    const map: Record<string, Issue[]> = {};
    for (const { issues } of orgData) for (const i of issues) { if (!map[i.project_id]) map[i.project_id] = []; map[i.project_id].push(i); }
    return map;
  }, [orgData]);

  const allIssues = orgData.flatMap(d => d.issues);
  const oneWeekAgo = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; }, []);

  const metricsItems = useMemo(() => {
    const active = allIssues.filter(i => !['done', 'cancelled'].includes(i.status)).length;
    const created = allIssues.filter(i => new Date(i.created_at) >= oneWeekAgo).length;
    const closed = allIssues.filter(i => ['done', 'cancelled'].includes(i.status) && new Date(i.updated_at) >= oneWeekAgo).length;
    const avgH = metrics?.avg_resolution_hours;
    const avgLabel = avgH != null ? (avgH >= 24 ? `${(avgH / 24).toFixed(1)}` : `${avgH.toFixed(1)}h`) : '—';
    const avgSub = avgH != null ? (avgH >= 24 ? 'days' : '') : '';
    return [
      { label: 'Active Issues', value: active, color: '#3b82f6', icon: TrendingUp, sub: `+${created} this week` },
      { label: 'Created', value: created, color: '#f59e0b', icon: Zap, sub: 'Last 7 days' },
      { label: 'Closed', value: closed, color: '#22c55e', icon: CheckCircle2, sub: closed > created ? 'On track' : undefined },
      { label: 'Avg Resolution', value: avgLabel, color: '#8b5cf6', icon: Timer, sub: avgSub || undefined },
    ];
  }, [allIssues, oneWeekAgo, metrics]);

  const pendingNavRef = useRef<string | null>(null);
  useEffect(() => {
    if (pendingNavRef.current && activeOrg) { const t = pendingNavRef.current; pendingNavRef.current = null; navigate(`/projects/${t}`); }
  }, [activeOrg, navigate]);

  const handleProjectNavigate = useCallback((orgId: string, project: Project) => {
    if (orgId === activeOrg?.id) { navigate(`/projects/${project.slug}`); }
    else { pendingNavRef.current = project.slug; setActive?.({ organization: orgId }); }
  }, [activeOrg?.id, navigate, setActive]);

  const sortedOrgData = useMemo(() => [...orgData].sort((a, b) => {
    if (a.org.id === activeOrg?.id) return -1;
    if (b.org.id === activeOrg?.id) return 1;
    return a.org.name.localeCompare(b.org.name);
  }), [orgData, activeOrg?.id]);

  const totalProjects = orgData.reduce((s, d) => s + d.projects.length, 0);

  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-6 md:py-8">
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-primary">{getGreeting()}</h1>
        <p className="text-secondary mt-1">
          {memberships.length > 1
            ? `${totalProjects} projects across ${memberships.length} organizations.`
            : `${totalProjects} projects in your workspace.`}
        </p>
      </div>

      {/* ── Unified Metrics Bar ── */}
      <div className="mb-6">
        <MetricsBar items={metricsItems} />
      </div>

      {/* ── Activity Chart ── */}
      {metrics && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[10px] font-semibold text-muted uppercase tracking-wider">Activity — 30 days</h2>
            <span className="text-[10px] text-muted">
              {metrics.issues_created?.reduce((s: number, p: any) => s + p.count, 0) ?? 0} created · {metrics.issues_closed?.reduce((s: number, p: any) => s + p.count, 0) ?? 0} closed
            </span>
          </div>
          <ActivityChart created={metrics.issues_created ?? []} closed={metrics.issues_closed ?? []} />
        </div>
      )}

      <div className="mb-6"><GlobalCreateIssueButton variant="big" /></div>

      {/* ── Main Grid: Projects + Right Panel ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Projects */}
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
          ) : sortedOrgData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-border bg-surface">
              <Kanban size={32} className="text-secondary mb-2" />
              <p className="text-sm text-secondary">{t('dashboard.noProjects')}</p>
            </div>
          ) : (
            sortedOrgData.map(({ org, projects }) => (
              <OrgSection
                key={org.id} orgName={org.name} orgSlug={org.slug}
                orgImageUrl={(org as any).imageUrl || (org as any).image_url}
                projects={projects} issuesByProject={issuesByProject}
                isCurrentOrg={org.id === activeOrg?.id}
                onSwitch={org.id !== activeOrg?.id ? () => setActive?.({ organization: org.id }) : undefined}
                onProjectNavigate={project => handleProjectNavigate(org.id, project)}
              />
            ))
          )}
        </div>

        {/* Right: Activity + Assigned + Feed */}
        <div className="space-y-4">
          <GamificationPanel />

          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-3">{t('dashboard.recentActivity')}</h2>
            <ActivityFeed limit={15} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
