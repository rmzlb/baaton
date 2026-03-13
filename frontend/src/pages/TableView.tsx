import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowUp, ArrowDown, Minus, OctagonAlert,
  Circle, Clock, Eye, CheckCircle2, XCircle, Archive,
  Copy, Check, ChevronUp, ChevronDown, ChevronsUpDown,
  Bug, Sparkles, Zap, HelpCircle,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { IssueDrawer } from '@/components/issues/IssueDrawer';
import { useIssuesStore } from '@/stores/issues';
import { cn } from '@/lib/utils';
import type { Issue } from '@/lib/types';

/* ── Status config ─── */
const STATUS_ICON: Record<string, typeof Circle> = {
  backlog: Archive,
  todo: Circle,
  in_progress: Clock,
  in_review: Eye,
  done: CheckCircle2,
  cancelled: XCircle,
};
const STATUS_COLOR: Record<string, string> = {
  backlog: 'text-muted',
  todo: 'text-blue-400',
  in_progress: 'text-amber-400',
  in_review: 'text-purple-400',
  done: 'text-emerald-400',
  cancelled: 'text-red-400',
};

/* ── Priority config ─── */
const PRIORITY_ICON: Record<string, typeof ArrowUp> = {
  urgent: OctagonAlert,
  high: ArrowUp,
  medium: Minus,
  low: ArrowDown,
};
const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-gray-400',
};

/* ── Type icon ─── */
const TYPE_ICON: Record<string, typeof Bug> = {
  bug: Bug,
  feature: Sparkles,
  improvement: Zap,
  question: HelpCircle,
};

/* ── Estimate label ─── */
const ESTIMATE_LABEL: Record<number, string> = { 1: 'XS', 2: 'S', 3: 'M', 5: 'L', 8: 'XL' };

/* ── Sort state ─── */
type SortKey = 'id' | 'title' | 'status' | 'priority' | 'type' | 'estimate' | 'due_date' | 'created_at' | 'updated_at';
type SortDir = 'asc' | 'desc';

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [id]);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); copy(); }}
      className="group flex items-center gap-1 font-mono text-[11px] text-muted hover:text-primary transition-colors"
    >
      <span>{id}</span>
      {copied
        ? <Check size={10} className="text-emerald-400" />
        : <Copy size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
      }
    </button>
  );
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown size={12} className="text-muted/40" />;
  return sortDir === 'asc'
    ? <ChevronUp size={12} className="text-accent" />
    : <ChevronDown size={12} className="text-accent" />;
}

/* ═══════════════════════════════════════════ */

export default function TableView() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const openDetail = useIssuesStore((s) => s.openDetail);
  const selectedIssueId = useIssuesStore((s) => s.selectedIssueId);
  const isDetailOpen = useIssuesStore((s) => s.isDetailOpen);
  const closeDetail = useIssuesStore((s) => s.closeDetail);

  // Open drawer if ?issue= param is set
  const issueParam = searchParams.get('issue');

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['all-issues'],
    queryFn: () => apiClient.issues.listAll({ limit: 2000 }),
    staleTime: 30_000,
  });

  /* ── Open drawer via URL param ── */
  const handleRowClick = useCallback((issueId: string) => {
    setSearchParams({ issue: issueId });
    openDetail(issueId);
  }, [openDetail, setSearchParams]);

  /* ── Sorting ── */
  const handleSort = (col: SortKey) => {
    if (col === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col);
      setSortDir('asc');
    }
  };

  const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, '': 4 };
  const STATUS_ORDER: Record<string, number> = {
    in_progress: 0, in_review: 1, todo: 2, backlog: 3, done: 4, cancelled: 5,
  };

  const sorted = useMemo(() => {
    const clone = [...issues];
    clone.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'id': cmp = a.id.localeCompare(b.id); break;
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'status': cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9); break;
        case 'priority': cmp = (PRIORITY_ORDER[a.priority ?? ''] ?? 9) - (PRIORITY_ORDER[b.priority ?? ''] ?? 9); break;
        case 'type': cmp = (a.type ?? '').localeCompare(b.type ?? ''); break;
        case 'estimate': cmp = (a.estimate ?? 0) - (b.estimate ?? 0); break;
        case 'due_date':
          cmp = (a.due_date ? new Date(a.due_date).getTime() : 0) - (b.due_date ? new Date(b.due_date).getTime() : 0);
          break;
        case 'created_at': cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime(); break;
        case 'updated_at': cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return clone;
  }, [issues, sortKey, sortDir]);

  /* ── Column header ── */
  function Th({ col, label }: { col: SortKey; label: string }) {
    return (
      <th
        className="px-3 py-2.5 text-left cursor-pointer select-none group hover:bg-surface-hover transition-colors"
        onClick={() => handleSort(col)}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted group-hover:text-secondary">
          {label}
          <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
        </div>
      </th>
    );
  }

  /* ── Row ── */
  function Row({ issue }: { issue: Issue }) {
    const StatusIcon = STATUS_ICON[issue.status] ?? Circle;
    const PriorityIcon = issue.priority ? (PRIORITY_ICON[issue.priority] ?? Minus) : null;
    const TypeIcon = issue.type ? (TYPE_ICON[issue.type] ?? Sparkles) : null;

    const isSelected = issue.id === selectedIssueId && isDetailOpen;

    return (
      <tr
        className={cn(
          'border-b border-border/50 cursor-pointer transition-colors group',
          isSelected ? 'bg-accent/5' : 'hover:bg-surface-hover/50',
        )}
        onClick={() => handleRowClick(issue.id)}
      >
        {/* ID */}
        <td className="px-3 py-2 w-[90px]">
          <CopyableId id={issue.id} />
        </td>
        {/* Title */}
        <td className="px-3 py-2 max-w-[320px]">
          <span className="text-sm text-primary truncate block group-hover:text-accent transition-colors">
            {issue.title}
          </span>
        </td>
        {/* Status */}
        <td className="px-3 py-2 w-[120px]">
          <span className={cn('flex items-center gap-1.5 text-xs', STATUS_COLOR[issue.status])}>
            <StatusIcon size={12} />
            <span className="capitalize">{issue.status.replace('_', ' ')}</span>
          </span>
        </td>
        {/* Priority */}
        <td className="px-3 py-2 w-[90px]">
          {PriorityIcon && issue.priority ? (
            <span className={cn('flex items-center gap-1 text-xs', PRIORITY_COLOR[issue.priority])}>
              <PriorityIcon size={12} />
              <span className="capitalize">{issue.priority}</span>
            </span>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </td>
        {/* Type */}
        <td className="px-3 py-2 w-[100px]">
          {TypeIcon && issue.type ? (
            <span className="flex items-center gap-1 text-xs text-secondary capitalize">
              <TypeIcon size={12} />
              {issue.type}
            </span>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </td>
        {/* Assignees */}
        <td className="px-3 py-2 w-[80px]">
          {issue.assignee_ids.length > 0 ? (
            <div className="flex -space-x-1">
              {issue.assignee_ids.slice(0, 3).map((id) => (
                <div
                  key={id}
                  className="h-5 w-5 rounded-full bg-surface-hover border border-bg flex items-center justify-center text-[8px] font-bold text-secondary"
                  title={id}
                >
                  {id.slice(5, 7).toUpperCase()}
                </div>
              ))}
              {issue.assignee_ids.length > 3 && (
                <div className="h-5 w-5 rounded-full bg-surface border border-bg flex items-center justify-center text-[8px] text-muted">
                  +{issue.assignee_ids.length - 3}
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </td>
        {/* Estimate */}
        <td className="px-3 py-2 w-[70px]">
          {issue.estimate ? (
            <span className="inline-block rounded border border-border px-1.5 py-0.5 text-[10px] font-mono font-medium text-secondary">
              {ESTIMATE_LABEL[issue.estimate] ?? `${issue.estimate}pt`}
            </span>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </td>
        {/* Due date */}
        <td className="px-3 py-2 w-[110px]">
          {issue.due_date ? (
            <span className={cn(
              'text-xs',
              new Date(issue.due_date) < new Date() && issue.status !== 'done'
                ? 'text-red-400'
                : 'text-secondary',
            )}>
              {formatDate(issue.due_date)}
            </span>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </td>
        {/* Tags */}
        <td className="px-3 py-2 w-[130px]">
          {issue.tags && issue.tags.length > 0 ? (
            <div className="flex flex-wrap gap-0.5">
              {issue.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface border border-border text-muted">
                  {tag}
                </span>
              ))}
              {issue.tags.length > 2 && (
                <span className="text-[10px] text-muted">+{issue.tags.length - 2}</span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </td>
        {/* Created */}
        <td className="px-3 py-2 w-[110px]">
          <span className="text-xs text-muted">{formatDate(issue.created_at)}</span>
        </td>
        {/* Updated */}
        <td className="px-3 py-2 w-[110px]">
          <span className="text-xs text-muted">{formatDate(issue.updated_at)}</span>
        </td>
      </tr>
    );
  }

  /* ── Selected issue for drawer ── */
  const drawerIssueId = selectedIssueId ?? issueParam ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-primary">{t('table.pageTitle')}</h1>
          <p className="text-xs text-muted mt-0.5">
            {isLoading ? t('common.loading') : `${sorted.length} ${t('table.issueCount')}`}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted">
            {t('common.loading')}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted">
            {t('list.noIssues')}
          </div>
        ) : (
          <table className="w-full border-collapse min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-bg border-b border-border">
              <tr>
                <Th col="id" label={t('table.id')} />
                <Th col="title" label={t('table.title')} />
                <Th col="status" label={t('table.status')} />
                <Th col="priority" label={t('table.priority')} />
                <Th col="type" label={t('table.type')} />
                <th className="px-3 py-2.5 text-left">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {t('table.assignees')}
                  </span>
                </th>
                <Th col="estimate" label={t('table.estimate')} />
                <Th col="due_date" label={t('table.dueDate')} />
                <th className="px-3 py-2.5 text-left">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {t('table.tags')}
                  </span>
                </th>
                <Th col="created_at" label={t('table.created')} />
                <Th col="updated_at" label={t('table.updated')} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((issue) => (
                <Row key={issue.id} issue={issue} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Issue Drawer */}
      {isDetailOpen && drawerIssueId && (
        <IssueDrawer
          issueId={drawerIssueId}
          onClose={() => {
            closeDetail();
            setSearchParams({});
          }}
        />
      )}
    </div>
  );
}
