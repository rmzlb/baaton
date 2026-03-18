import type { DraggableProvided } from '@hello-pangea/dnd';
import {
  Bug, Sparkles, Zap, HelpCircle,
  ArrowUp, ArrowDown, Minus, OctagonAlert,
  Clock, MoreHorizontal, CheckCircle2,
} from 'lucide-react';
import { cn, timeAgo } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';
import { useClerkMembers } from '@/hooks/useClerkMembers';
import { useMemberResolutionContext } from '@/contexts/MemberResolutionContext';
import { GitHubPrBadge } from '@/components/github/GitHubPrBadge';
import { CopyableId } from '@/components/shared/CopyableId';
import { evaluateIssueSla } from '@/lib/sla';
import type { Issue, IssuePriority, IssueType, ProjectTag, GitHubPrLink } from '@/lib/types';

/* ─── Helpers ───────────────────────────────────────── */

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol|blockquote|tr)[\s>]/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

/** Filter out system-generated tags (auto:*) — only show human tags */
function userTags(tags: string[]): string[] {
  return tags.filter((t) => !t.startsWith('auto:'));
}

/** Shorten a display name: handle apikey IDs, emails, long names */
function shortName(raw: string): string {
  if (!raw) return '';
  // apikey:xxxx → "agent"
  if (raw.startsWith('apikey:')) return 'agent';
  // email → first part before @
  if (raw.includes('@')) return raw.split('@')[0];
  // "Rmz lb" → "Rmz"
  return raw.split(' ')[0].slice(0, 10);
}

/* ─── Type config ───────────────────────────────────── */

interface KanbanCardProps {
  issue: Issue;
  provided: DraggableProvided;
  isDragging: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent, issue: Issue) => void;
  selected?: boolean;
  onSelect?: (id: string, shiftKey: boolean) => void;
  projectTags?: ProjectTag[];
  githubPrs?: GitHubPrLink[];
}

const typeConfig: Record<IssueType, { icon: typeof Bug; color: string; bg: string; label: string }> = {
  bug:         { icon: Bug,        color: 'text-red-600 dark:text-red-400',       bg: 'bg-red-50 dark:bg-red-500/10',       label: 'Bug' },
  feature:     { icon: Sparkles,   color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-500/10', label: 'Feature' },
  improvement: { icon: Zap,        color: 'text-blue-600 dark:text-blue-400',     bg: 'bg-blue-50 dark:bg-blue-500/10',     label: 'Improvement' },
  question:    { icon: HelpCircle, color: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-500/10',   label: 'Question' },
};

const priorityConfig: Record<IssuePriority, { icon: typeof ArrowUp; color: string; label: string }> = {
  urgent: { icon: OctagonAlert, color: 'text-red-500',    label: 'Urgent' },
  high:   { icon: ArrowUp,     color: 'text-orange-500', label: 'High' },
  medium: { icon: Minus,       color: 'text-yellow-500', label: 'Medium' },
  low:    { icon: ArrowDown,   color: 'text-gray-400',   label: 'Low' },
};

/* ─── Tag styles ────────────────────────────────────── */

function getTagStyle(color: string) {
  const MAP: Record<string, { bg: string; text: string; border: string }> = {
    '#3b82f6': { bg: 'bg-blue-50 dark:bg-blue-500/10',       text: 'text-blue-700 dark:text-blue-400',       border: 'border-blue-100 dark:border-blue-500/20' },
    '#22c55e': { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-100 dark:border-emerald-500/20' },
    '#8b5cf6': { bg: 'bg-purple-50 dark:bg-purple-500/10',   text: 'text-purple-700 dark:text-purple-400',   border: 'border-purple-100 dark:border-purple-500/20' },
    '#f97316': { bg: 'bg-orange-50 dark:bg-orange-500/10',   text: 'text-orange-700 dark:text-orange-400',   border: 'border-orange-100 dark:border-orange-500/20' },
    '#ef4444': { bg: 'bg-red-50 dark:bg-red-500/10',         text: 'text-red-700 dark:text-red-400',         border: 'border-red-100 dark:border-red-500/20' },
    '#eab308': { bg: 'bg-yellow-50 dark:bg-yellow-500/10',   text: 'text-yellow-700 dark:text-yellow-400',   border: 'border-yellow-100 dark:border-yellow-500/20' },
    '#ec4899': { bg: 'bg-pink-50 dark:bg-pink-500/10',       text: 'text-pink-700 dark:text-pink-400',       border: 'border-pink-100 dark:border-pink-500/20' },
    '#06b6d4': { bg: 'bg-cyan-50 dark:bg-cyan-500/10',       text: 'text-cyan-700 dark:text-cyan-400',       border: 'border-cyan-100 dark:border-cyan-500/20' },
    '#14b8a6': { bg: 'bg-teal-50 dark:bg-teal-500/10',       text: 'text-teal-700 dark:text-teal-400',       border: 'border-teal-100 dark:border-teal-500/20' },
  };
  return MAP[color] || { bg: 'bg-gray-100 dark:bg-gray-500/10', text: 'text-gray-600 dark:text-gray-400', border: 'border-gray-200 dark:border-gray-500/20' };
}

/* ─── Sub-components ────────────────────────────────── */

function DueDate({ date }: { date: string }) {
  const due = new Date(date);
  const now = new Date();
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const isOverdue = diffDays < 0;
  const isSoon = diffDays >= 0 && diffDays <= 3;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[10px] whitespace-nowrap shrink-0',
      isOverdue ? 'text-red-500' : isSoon ? 'text-amber-500' : 'text-gray-400 dark:text-muted',
    )}>
      <Clock size={10} />
      {due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
    </span>
  );
}

/** Type icon only (no text label) — for compact/default header */
function TypeIcon({ type }: { type: IssueType }) {
  const cfg = typeConfig[type] ?? typeConfig.feature;
  const Icon = cfg.icon;
  return (
    <span className={cn('shrink-0', cfg.color)} title={cfg.label}>
      <Icon size={12} />
    </span>
  );
}

/** Type badge with text — spacious footer only */
function TypeBadge({ type }: { type: IssueType }) {
  const cfg = typeConfig[type] ?? typeConfig.feature;
  const Icon = cfg.icon;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border shrink-0',
      cfg.bg, cfg.color,
      type === 'bug' ? 'border-red-100 dark:border-red-500/20' :
      type === 'feature' ? 'border-purple-100 dark:border-purple-500/20' :
      type === 'improvement' ? 'border-blue-100 dark:border-blue-500/20' :
      'border-amber-100 dark:border-amber-500/20',
    )}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function SlaBadge({ issue }: { issue: Issue }) {
  const sla = evaluateIssueSla(issue);
  if ((issue.priority !== 'urgent' && issue.priority !== 'high') || sla.status === 'completed' || sla.status === 'ok') return null;
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide shrink-0',
      sla.status === 'breached' && 'bg-red-500/15 text-red-400',
      sla.status === 'at_risk' && 'bg-amber-500/15 text-amber-400',
    )} title={`SLA ${sla.status}`}>SLA</span>
  );
}

function StatusAge({ issue }: { issue: Issue }) {
  if (issue.status === 'backlog') return null;
  const isDone = issue.status === 'done' || issue.status === 'cancelled';
  const ts = isDone ? issue.closed_at : issue.status_changed_at;
  if (!ts) return null;

  const age = timeAgo(ts);
  const isStale = (() => {
    const days = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24);
    if (issue.status === 'in_progress' && days > 7) return true;
    if (issue.status === 'in_review' && days > 3) return true;
    if (issue.status === 'todo' && days > 14) return true;
    return false;
  })();

  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[9px] tabular-nums whitespace-nowrap shrink-0',
      isDone ? 'text-emerald-500/70' : isStale ? 'text-orange-400' : 'text-muted',
    )} title={`${isDone ? 'Closed' : `In ${issue.status.replace('_', ' ')}`} since ${new Date(ts).toLocaleDateString()}`}>
      <Clock size={9} />
      {age}
    </span>
  );
}

function isNew(created_at: string, updated_at?: string): boolean {
  const age = Date.now() - new Date(created_at).getTime();
  if (age > 24 * 60 * 60 * 1000) return false;
  if (updated_at && Math.abs(new Date(updated_at).getTime() - new Date(created_at).getTime()) > 60 * 60 * 1000) return false;
  return true;
}

/** Check if an assignee name looks like an agent */
function isAgent(name: string): boolean {
  return name.startsWith('apikey:') || name.toLowerCase().startsWith('agent');
}

/* Assignee avatar helper */
function AssigneeAvatar({ id, size = 5, resolveUserName, resolveUserAvatar, issueUpdatedAt }: {
  id: string; size?: number;
  resolveUserName: (id: string) => string;
  resolveUserAvatar: (id: string) => string | undefined;
  issueUpdatedAt?: string;
}) {
  const name = resolveUserName(id);
  const avatar = resolveUserAvatar(id);
  const px = size === 4 ? 'w-4 h-4' : 'w-5 h-5';
  const agentFlag = isAgent(name);
  const agentActive = agentFlag && issueUpdatedAt
    ? (Date.now() - new Date(issueUpdatedAt).getTime()) < 5 * 60 * 1000
    : false;

  return (
    <span className="relative inline-flex shrink-0">
      <img
        src={avatar || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=f0f0f0&textColor=666666`}
        className={cn(px, 'rounded-full ring-1 ring-white dark:ring-surface')}
        alt={name}
        title={name}
      />
      {agentFlag && (
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 block rounded-full ring-1 ring-white dark:ring-surface',
            size === 4 ? 'h-1.5 w-1.5' : 'h-2 w-2',
            agentActive ? 'bg-emerald-500' : 'bg-gray-400',
          )}
          title={agentActive ? 'Agent active' : 'Agent inactive'}
        />
      )}
    </span>
  );
}

/** Tag pill with max-width truncation */
function TagPill({ tag, color, maxW = 'max-w-[80px]' }: { tag: string; color: string; maxW?: string }) {
  const style = getTagStyle(color);
  return (
    <span
      className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border truncate', maxW, style.bg, style.text, style.border)}
      title={tag}
    >
      {tag}
    </span>
  );
}

/* ─── Left border state ─────────────────────────────── */

function getLeftBorderClass(issue: Issue): string {
  // SLA breach (highest priority)
  const sla = evaluateIssueSla(issue);
  if (sla.status === 'breached') return 'border-l-[3px] border-l-red-500';
  if (sla.status === 'at_risk') return 'border-l-[3px] border-l-amber-500';

  // Blocked tag
  if (issue.tags.some((t) => t.toLowerCase().includes('blocked'))) return 'border-l-[3px] border-l-orange-400';

  // Stale: in_progress > 7d, in_review > 3d
  if (issue.status_changed_at) {
    const days = (Date.now() - new Date(issue.status_changed_at).getTime()) / (1000 * 60 * 60 * 24);
    if (issue.status === 'in_progress' && days > 7) return 'border-l-[3px] border-l-gray-400';
    if (issue.status === 'in_review' && days > 3) return 'border-l-[3px] border-l-gray-400';
  }

  // NEW (< 24h)
  if (isNew(issue.created_at, issue.updated_at)) return 'border-l-[3px] border-l-emerald-400';

  return '';
}

/* ─── Main Component ────────────────────────────────── */

export function KanbanCard({ issue, provided, isDragging, onClick, onContextMenu, selected = false, onSelect, projectTags = [], githubPrs = [] }: KanbanCardProps) {
  const handleContextMenu = (e: React.MouseEvent) => {
    if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, issue); }
  };

  const SelectCheckbox = onSelect ? (
    <span
      onClick={(e) => { e.stopPropagation(); onSelect(issue.id, e.shiftKey); }}
      className={cn(
        'absolute top-1.5 left-1.5 z-10 flex items-center justify-center w-4 h-4 rounded border cursor-pointer transition-all',
        selected ? 'bg-accent border-accent text-black opacity-100' : 'border-gray-300 dark:border-border bg-white dark:bg-surface opacity-0 group-hover/card:opacity-100',
      )}
    >
      {selected && <span className="text-[9px] font-bold">✓</span>}
    </span>
  ) : null;

  const density = useUIStore((s) => s.density);
  const crossOrg = useMemberResolutionContext();
  const clerk = useClerkMembers();
  const resolveUserName = crossOrg?.resolveUserName ?? clerk.resolveUserName;
  const resolveUserAvatar = crossOrg?.resolveUserAvatar ?? clerk.resolveUserAvatar;
  const PriorityConfig = issue.priority ? (priorityConfig[issue.priority] ?? null) : null;
  const isDone = issue.status === 'done' || issue.status === 'cancelled';
  const tags = userTags(issue.tags);
  const getTagColor = (tagName: string) => projectTags.find((t) => t.name === tagName)?.color || '#6b7280';
  const leftBorder = isDone ? '' : getLeftBorderClass(issue);

  /* ── COMPACT ─────────────────────────────────────── */
  if (density === 'compact') {
    return (
      <div
        ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
        onClick={onClick} onContextMenu={handleContextMenu}
        role="article" aria-roledescription="draggable item" aria-label={`${issue.display_id}: ${issue.title}`}
        style={provided.draggableProps.style}
        className={cn(
          'group group/card relative cursor-pointer rounded-md border border-gray-200 dark:border-border bg-white dark:bg-surface px-2.5 py-1.5 will-change-transform transition-all duration-200 shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-border',
          isDone && 'opacity-60 hover:opacity-90',
          isDragging && 'shadow-xl border-accent/30 rotate-1 scale-[1.02]',
          selected && 'ring-2 ring-accent/40 border-accent/30',
          leftBorder,
        )}
      >
        {SelectCheckbox}
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Priority or done icon */}
          {isDone ? (
            <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
          ) : PriorityConfig ? (
            <PriorityConfig.icon size={12} className={cn(PriorityConfig.color, 'shrink-0')} />
          ) : null}

          {/* ID — never wraps */}
          <CopyableId id={issue.display_id} className="text-[10px] text-gray-400 dark:text-muted shrink-0 whitespace-nowrap" iconSize={8} />

          <SlaBadge issue={issue} />
          <StatusAge issue={issue} />

          {/* Title — fills remaining space */}
          <span className={cn(
            'text-xs font-medium truncate flex-1 min-w-0',
            isDone ? 'line-through text-gray-400 dark:text-muted' : 'text-gray-900 dark:text-primary',
          )}>{issue.title}</span>

          {/* One tag max (user tags only), truncated */}
          {tags.slice(0, 1).map((tag) => (
            <TagPill key={tag} tag={tag} color={getTagColor(tag)} maxW="max-w-[60px]" />
          ))}

          {/* Assignee avatar */}
          {issue.assignee_ids.length > 0 && (
            <AssigneeAvatar id={issue.assignee_ids[0]} size={4} resolveUserName={resolveUserName} resolveUserAvatar={resolveUserAvatar} issueUpdatedAt={issue.updated_at} />
          )}
        </div>
      </div>
    );
  }

  /* ── SPACIOUS ────────────────────────────────────── */
  if (density === 'spacious') {
    return (
      <div
        ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
        onClick={onClick} onContextMenu={handleContextMenu}
        role="article" aria-roledescription="draggable item" aria-label={`${issue.display_id}: ${issue.title}`}
        style={provided.draggableProps.style}
        className={cn(
          'group cursor-pointer rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-surface p-4 will-change-transform transition-all duration-200 shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-border',
          isDone && 'opacity-70 hover:opacity-100',
          isDragging && 'shadow-xl border-accent/30 rotate-1 scale-[1.02]',
          selected && 'ring-2 ring-accent/40 border-accent/30',
          leftBorder,
        )}
      >
        {SelectCheckbox}
        {/* Header: ID + status age — right: menu */}
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <CopyableId id={issue.display_id} className="text-xs text-gray-400 dark:text-muted whitespace-nowrap" />
            {isNew(issue.created_at, issue.updated_at) && <span className="text-[9px] font-bold text-emerald-500 uppercase shrink-0">NEW</span>}
            <StatusAge issue={issue} />
          </div>
          <div className="p-1 rounded hover:bg-gray-100 dark:hover:bg-surface-hover text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Title */}
        <h3 className={cn(
          'text-sm font-medium leading-snug tracking-tight mb-2',
          isDone ? 'line-through text-gray-400 dark:text-muted' : 'text-gray-900 dark:text-primary',
        )}>{issue.title}</h3>

        {/* Description preview */}
        {issue.description && !isDone && (() => {
          const preview = stripHtml(issue.description);
          return preview ? <p className="text-xs text-gray-500 dark:text-muted leading-relaxed line-clamp-2 mb-3">{preview}</p> : null;
        })()}

        {/* Row 1: Type + tags */}
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <TypeBadge type={issue.type} />
          <SlaBadge issue={issue} />
          {tags.slice(0, 3).map((tag) => (
            <TagPill key={tag} tag={tag} color={getTagColor(tag)} maxW="max-w-[100px]" />
          ))}
          {tags.length > 3 && <span className="text-[10px] text-gray-400">+{tags.length - 3}</span>}
        </div>

        {/* Row 2: due + priority + assignees (separator line) */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-border/50">
          <div className="flex items-center gap-2">
            {issue.due_date && <DueDate date={issue.due_date} />}
            {githubPrs.length > 0 && <GitHubPrBadge prs={githubPrs} />}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isDone ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            ) : PriorityConfig ? (
              <PriorityConfig.icon className={cn('w-3.5 h-3.5', PriorityConfig.color)} />
            ) : null}
            {issue.assignee_ids.length > 0 && (
              <div className="flex -space-x-1.5">
                {issue.assignee_ids.slice(0, 3).map((id) => (
                  <AssigneeAvatar key={id} id={id} resolveUserName={resolveUserName} resolveUserAvatar={resolveUserAvatar} issueUpdatedAt={issue.updated_at} />
                ))}
                {issue.assignee_ids.length > 3 && <span className="text-[9px] text-muted ml-1">+{issue.assignee_ids.length - 3}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ── DEFAULT ─────────────────────────────────────── */
  return (
    <div
      ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
      onClick={onClick} onContextMenu={handleContextMenu}
      role="article" aria-roledescription="draggable item" aria-label={`${issue.display_id}: ${issue.title}`}
      style={provided.draggableProps.style}
      className={cn(
        'group cursor-pointer rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-surface p-3.5 will-change-transform transition-all duration-200 shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-border',
        isDone && 'opacity-85 hover:opacity-100',
        isDragging && 'shadow-xl border-accent/30 rotate-1 scale-[1.02]',
        selected && 'ring-2 ring-accent/40 border-accent/30',
        leftBorder,
      )}
    >
      {SelectCheckbox}
      {/* Header: priority + ID + type icon | status age + menu */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isDone ? (
            <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
          ) : PriorityConfig ? (
            <PriorityConfig.icon size={13} className={cn(PriorityConfig.color, 'shrink-0')} />
          ) : null}
          <CopyableId id={issue.display_id} className="text-[11px] text-gray-400 dark:text-muted whitespace-nowrap" />
          <TypeIcon type={issue.type} />
          {isNew(issue.created_at, issue.updated_at) && <span className="text-[8px] font-bold text-emerald-500 uppercase shrink-0">NEW</span>}
          <SlaBadge issue={issue} />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusAge issue={issue} />
          <div
            className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-surface-hover text-gray-400 dark:text-muted opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* Title */}
      <h3 className={cn(
        'text-sm font-medium mb-2.5 leading-snug tracking-tight line-clamp-2',
        isDone ? 'line-through text-gray-400 dark:text-muted' : 'text-gray-900 dark:text-primary',
      )}>{issue.title}</h3>

      {/* Footer: tags + due | PR + assignee */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          {tags.slice(0, 2).map((tag) => (
            <TagPill key={tag} tag={tag} color={getTagColor(tag)} maxW="max-w-[80px]" />
          ))}
          {tags.length > 2 && <span className="text-[10px] text-gray-400">+{tags.length - 2}</span>}
          {issue.due_date && <DueDate date={issue.due_date} />}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {githubPrs.length > 0 && <GitHubPrBadge prs={githubPrs} />}
          {issue.assignee_ids.length > 0 && (
            <AssigneeAvatar id={issue.assignee_ids[0]} resolveUserName={resolveUserName} resolveUserAvatar={resolveUserAvatar} issueUpdatedAt={issue.updated_at} />
          )}
        </div>
      </div>
    </div>
  );
}
