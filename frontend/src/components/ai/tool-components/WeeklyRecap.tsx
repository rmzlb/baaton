import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  GitCommit,
  Plus,
  Sparkles,
  Users,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────

interface CreatedIssue {
  display_id: string;
  title: string;
  priority?: string | null;
  category?: string[] | null;
  author?: string | null;
  project_prefix?: string | null;
  project_name?: string | null;
  created_at?: string | null;
}

interface StatusChange {
  display_id?: string | null;
  title?: string | null;
  project_prefix?: string | null;
  from?: string | null;
  to?: string | null;
  by?: string | null;
  at?: string | null;
}

interface ByAuthor {
  author: string;
  created: number;
  closed: number;
  status_changes: number;
}

interface ClosedIssue {
  display_id: string;
  title: string;
  status?: string;
  priority?: string | null;
  project_name?: string | null;
}

interface WeeklyRecapData {
  period_days?: number;
  since?: string;
  scope_label?: string;
  completed_count?: number;
  new_created_count?: number;
  status_changes_count?: number;
  blocker_count?: number;
  top_contributor?: string | null;
  created_issues?: CreatedIssue[];
  status_changes?: StatusChange[];
  by_author?: ByAuthor[];
  completed_issues?: ClosedIssue[];

  // Legacy fields (kept for backward compatibility with old payloads)
  period?: string;
  new_count?: number;
  blockers?: string[];
  highlights?: string[];
}

interface WeeklyRecapProps {
  data: WeeklyRecapData | WeeklyRecapData[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function initialsOf(name: string): string {
  return name
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

function relativeTime(iso?: string | null, t?: ReturnType<typeof useTranslation>['t']): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return t?.('aiChat.recap.relative.now', { defaultValue: 'now' }) ?? 'now';
  if (mins < 60) return t?.('aiChat.recap.relative.minutes', { count: mins, defaultValue: `${mins}m` }) ?? `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t?.('aiChat.recap.relative.hours', { count: hours, defaultValue: `${hours}h` }) ?? `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return t?.('aiChat.recap.relative.days', { count: days, defaultValue: `${days}d` }) ?? `${days}d`;
  return date.toLocaleDateString();
}

function priorityDot(p?: string | null): string {
  switch ((p ?? '').toLowerCase()) {
    case 'urgent':
      return 'bg-red-400';
    case 'high':
      return 'bg-amber-400';
    case 'medium':
      return 'bg-blue-400';
    case 'low':
      return 'bg-[--color-muted]';
    default:
      return 'bg-[--color-border]';
  }
}

function statusTone(s?: string | null): { dot: string; text: string } {
  switch ((s ?? '').toLowerCase()) {
    case 'done':
    case 'completed':
      return { dot: 'bg-emerald-400', text: 'text-emerald-300' };
    case 'in_progress':
    case 'in-progress':
      return { dot: 'bg-amber-400', text: 'text-amber-300' };
    case 'todo':
    case 'backlog':
      return { dot: 'bg-blue-400', text: 'text-blue-300' };
    case 'blocked':
      return { dot: 'bg-red-400', text: 'text-red-300' };
    case 'cancelled':
    case 'canceled':
      return { dot: 'bg-[--color-muted]', text: 'text-[--color-muted] line-through' };
    default:
      return { dot: 'bg-[--color-border]', text: 'text-[--color-secondary]' };
  }
}

// ─── Hero stat tile (flat, no individual border) ──────────────────────────

function HeroStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'blue' | 'amber' | 'red' | 'emerald';
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

// ─── Section wrapper (no nested borders) ──────────────────────────────────

function Section({
  title,
  icon: Icon,
  count,
  children,
  expandable = false,
  defaultExpanded = true,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  count?: number;
  children: React.ReactNode;
  expandable?: boolean;
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  const Header = (
    <div className="flex items-center justify-between px-3.5 py-2 group">
      <div className="flex items-center gap-1.5">
        <Icon size={11} className="text-[--color-muted]" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
          {title}
        </span>
        {count !== undefined && (
          <span className="text-[10px] tabular-nums text-[--color-muted]">· {count}</span>
        )}
      </div>
      {expandable && (
        <span className="text-[--color-muted] group-hover:text-[--color-primary] transition-colors">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      )}
    </div>
  );
  return (
    <div>
      {expandable ? (
        <button
          type="button"
          className="w-full text-left hover:bg-[--color-surface-hover] transition-colors"
          onClick={() => setOpen((v) => !v)}
        >
          {Header}
        </button>
      ) : (
        Header
      )}
      {(!expandable || open) && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

// ─── Author chip ──────────────────────────────────────────────────────────

function AuthorChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 max-w-[140px]">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 text-[9px] font-semibold shrink-0">
        {initialsOf(name)}
      </span>
      <span className="text-[--color-secondary] truncate text-[11px]">
        {name.replace(/^@/, '')}
      </span>
    </span>
  );
}

// ─── Created issue row ────────────────────────────────────────────────────

function CreatedRow({ i, t }: { i: CreatedIssue; t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[--color-surface-hover] transition-colors min-w-0">
      <span
        className={cn('h-1.5 w-1.5 rounded-full shrink-0', priorityDot(i.priority))}
        title={i.priority ?? ''}
        aria-hidden="true"
      />
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[10px] font-bold text-amber-400 shrink-0">
          {i.project_prefix ?? '·'}
        </span>
        <span className="text-[11px] tabular-nums text-[--color-muted] shrink-0">
          {i.display_id}
        </span>
        <span className="text-[12px] text-[--color-primary] truncate min-w-0">{i.title}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {i.author && <AuthorChip name={i.author} />}
        <span className="text-[10px] tabular-nums text-[--color-muted] hidden sm:inline">
          {relativeTime(i.created_at, t)}
        </span>
      </div>
    </div>
  );
}

// ─── Status change row ────────────────────────────────────────────────────

function StatusChangeRow({
  c,
  t,
}: {
  c: StatusChange;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const fromTone = statusTone(c.from);
  const toTone = statusTone(c.to);
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[--color-surface-hover] transition-colors min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[10px] font-bold text-amber-400 shrink-0">
          {c.project_prefix ?? '·'}
        </span>
        <span className="text-[11px] tabular-nums text-[--color-muted] shrink-0">
          {c.display_id ?? '—'}
        </span>
        <span className="text-[12px] text-[--color-primary] truncate min-w-0">
          {c.title ?? t('aiChat.recap.deletedIssue', { defaultValue: '(deleted issue)' })}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[10px] uppercase tracking-wide',
            fromTone.text,
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', fromTone.dot)} aria-hidden="true" />
          {c.from ?? '—'}
        </span>
        <ArrowRight size={10} className="text-[--color-muted]" />
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-medium',
            toTone.text,
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', toTone.dot)} aria-hidden="true" />
          {c.to ?? '—'}
        </span>
        {c.by && (
          <span className="hidden sm:inline-flex pl-1 ml-1 border-l border-[--color-border]">
            <AuthorChip name={c.by} />
          </span>
        )}
        <span className="text-[10px] tabular-nums text-[--color-muted] hidden sm:inline">
          {relativeTime(c.at, t)}
        </span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export default function WeeklyRecap({ data }: WeeklyRecapProps) {
  const { t } = useTranslation();
  const recap: WeeklyRecapData = Array.isArray(data) ? data[0] ?? {} : data ?? {};

  // Normalize legacy fields
  const newCreatedCount = recap.new_created_count ?? recap.new_count ?? 0;
  const periodDays = recap.period_days ?? 7;
  const created = recap.created_issues ?? [];
  const changes = recap.status_changes ?? [];
  const closed = recap.completed_issues ?? [];
  const authors = recap.by_author ?? [];

  // Show top 8 created/changes by default; offer expand for rest
  const topCreated = useMemo(() => created.slice(0, 8), [created]);
  const topChanges = useMemo(() => changes.slice(0, 8), [changes]);

  const hasAnyContent =
    newCreatedCount > 0 ||
    (recap.status_changes_count ?? 0) > 0 ||
    (recap.completed_count ?? 0) > 0;

  return (
    <div className="rounded-xl border border-[--color-border] bg-[--color-surface] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles size={12} className="text-amber-400 shrink-0" />
          <span className="text-[12px] font-semibold text-[--color-primary] truncate">
            {t('aiChat.recap.title', { defaultValue: 'Weekly recap' })}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[--color-muted] tabular-nums shrink-0">
          {t('aiChat.recap.period', {
            days: periodDays,
            defaultValue: `Last ${periodDays}d`,
          })}
        </span>
      </div>

      <div className="border-t border-[--color-border]" />

      {/* Hero stats */}
      <div className="grid grid-cols-3 gap-3 px-3.5 py-3">
        <HeroStat
          label={t('aiChat.recap.kpi.created', { defaultValue: 'Created' })}
          value={newCreatedCount}
          tone="blue"
        />
        <HeroStat
          label={t('aiChat.recap.kpi.statusChanges', { defaultValue: 'Status changes' })}
          value={recap.status_changes_count ?? 0}
          tone="amber"
        />
        <HeroStat
          label={t('aiChat.recap.kpi.closed', { defaultValue: 'Closed' })}
          value={recap.completed_count ?? 0}
          tone="emerald"
        />
      </div>

      {!hasAnyContent && (
        <>
          <div className="border-t border-[--color-border]" />
          <div className="px-3.5 py-4 text-center text-[12px] text-[--color-muted] italic">
            {t('aiChat.recap.empty', {
              days: periodDays,
              defaultValue: `Nothing recorded over the last ${periodDays}d`,
            })}
          </div>
        </>
      )}

      {/* Section: Created tickets */}
      {topCreated.length > 0 && (
        <>
          <div className="border-t border-[--color-border]" />
          <Section
            title={t('aiChat.recap.sections.created', { defaultValue: 'Created' })}
            icon={Plus}
            count={newCreatedCount}
          >
            {topCreated.map((i) => (
              <CreatedRow key={i.display_id} i={i} t={t} />
            ))}
            {created.length > 8 && (
              <div className="px-2 py-1 text-[10px] text-[--color-muted] tabular-nums">
                {t('aiChat.recap.andMore', {
                  count: created.length - 8,
                  defaultValue: `+${created.length - 8} more`,
                })}
              </div>
            )}
          </Section>
        </>
      )}

      {/* Section: Status changes */}
      {topChanges.length > 0 && (
        <>
          <div className="border-t border-[--color-border]" />
          <Section
            title={t('aiChat.recap.sections.statusChanges', {
              defaultValue: 'Status changes',
            })}
            icon={GitCommit}
            count={recap.status_changes_count ?? topChanges.length}
          >
            {topChanges.map((c, idx) => (
              <StatusChangeRow key={`${c.display_id}-${c.at}-${idx}`} c={c} t={t} />
            ))}
            {changes.length > 8 && (
              <div className="px-2 py-1 text-[10px] text-[--color-muted] tabular-nums">
                {t('aiChat.recap.andMore', {
                  count: changes.length - 8,
                  defaultValue: `+${changes.length - 8} more`,
                })}
              </div>
            )}
          </Section>
        </>
      )}

      {/* Section: Closed (collapsed by default to keep the card scannable) */}
      {closed.length > 0 && (
        <>
          <div className="border-t border-[--color-border]" />
          <Section
            title={t('aiChat.recap.sections.closed', { defaultValue: 'Closed' })}
            icon={CheckCircle2}
            count={closed.length}
            expandable
            defaultExpanded={false}
          >
            {closed.slice(0, 12).map((c) => (
              <div
                key={c.display_id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[--color-surface-hover] transition-colors min-w-0"
              >
                <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                <span className="text-[11px] tabular-nums text-[--color-muted] shrink-0">
                  {c.display_id}
                </span>
                <span className="text-[12px] text-[--color-primary] truncate flex-1 min-w-0">
                  {c.title}
                </span>
                {c.project_name && (
                  <span className="text-[10px] text-[--color-muted] truncate hidden sm:inline">
                    {c.project_name}
                  </span>
                )}
              </div>
            ))}
            {closed.length > 12 && (
              <div className="px-2 py-1 text-[10px] text-[--color-muted] tabular-nums">
                {t('aiChat.recap.andMore', {
                  count: closed.length - 12,
                  defaultValue: `+${closed.length - 12} more`,
                })}
              </div>
            )}
          </Section>
        </>
      )}

      {/* Section: By contributor */}
      {authors.length > 0 && (
        <>
          <div className="border-t border-[--color-border]" />
          <div className="px-3.5 py-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Users size={11} className="text-[--color-muted]" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
                {t('aiChat.recap.sections.byAuthor', { defaultValue: 'By contributor' })}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {authors.map((a) => (
                <span
                  key={a.author}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[--color-surface-hover] px-2 py-1 text-[11px]"
                  title={t('aiChat.recap.byAuthorTooltip', {
                    created: a.created,
                    closed: a.closed,
                    changes: a.status_changes,
                    defaultValue: `${a.created} created · ${a.closed} closed · ${a.status_changes} changes`,
                  })}
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 text-[9px] font-semibold">
                    {initialsOf(a.author)}
                  </span>
                  <span className="text-[--color-secondary] truncate max-w-[110px]">
                    {a.author.replace(/^@/, '')}
                  </span>
                  {a.created > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 tabular-nums text-blue-300"
                      title={t('aiChat.recap.kpi.created', { defaultValue: 'Created' })}
                    >
                      <Plus size={9} />
                      {a.created}
                    </span>
                  )}
                  {a.closed > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 tabular-nums text-emerald-300"
                      title={t('aiChat.recap.kpi.closed', { defaultValue: 'Closed' })}
                    >
                      <CheckCircle2 size={9} />
                      {a.closed}
                    </span>
                  )}
                  {a.status_changes > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 tabular-nums text-amber-300"
                      title={t('aiChat.recap.kpi.statusChanges', { defaultValue: 'Changes' })}
                    >
                      <Clock size={9} />
                      {a.status_changes}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
