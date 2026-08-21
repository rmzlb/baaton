import { useState, useMemo, useCallback } from 'react';
import { Draggable, type DroppableProvided } from '@hello-pangea/dnd';
import { Plus } from 'lucide-react';
import { KanbanCard } from './KanbanCard';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Issue, ProjectStatus, ProjectTag } from '@/lib/types';

/* ─── Sub-status derivation ─────────────────────── */

interface SubStatus {
  key: string;
  label: string;
}

function getSubStatuses(statusKey: string): SubStatus[] | null {
  if (statusKey === 'in_review') {
    return [
      { key: 'all', label: 'All' },
      { key: 'needs_review', label: 'Needs review' },
      { key: 'approved', label: 'Approved' },
      { key: 'blocked', label: 'Blocked' },
    ];
  }
  if (statusKey === 'in_progress') {
    return [
      { key: 'all', label: 'All' },
      { key: 'active', label: 'Active' },
      { key: 'blocked', label: 'Blocked' },
    ];
  }
  return null;
}

function deriveSubStatus(issue: Issue, statusKey: string): string {
  const isBlocked = issue.tags.some((t) => t.toLowerCase().includes('blocked'));
  if (isBlocked) return 'blocked';

  if (statusKey === 'in_review') {
    // "approved" if tag contains "approved"
    if (issue.tags.some((t) => t.toLowerCase().includes('approved'))) return 'approved';
    // Stale in review (> 3 days) = needs attention
    if (issue.status_changed_at) {
      const days = (Date.now() - new Date(issue.status_changed_at).getTime()) / (1000 * 60 * 60 * 24);
      if (days > 3) return 'needs_review';
    }
    return 'needs_review';
  }

  if (statusKey === 'in_progress') {
    return 'active';
  }

  return 'all';
}

interface KanbanColumnProps {
  status: ProjectStatus;
  issues: Issue[];
  provided: DroppableProvided;
  isDraggingOver: boolean;
  onIssueClick: (issue: Issue) => void;
  onContextMenu?: (e: React.MouseEvent, issue: Issue) => void;
  selectedIds?: Set<string>;
  onSelect?: (id: string, shiftKey: boolean) => void;
  onCreateIssue?: (statusKey: string) => void;
  projectTags?: ProjectTag[];
}

const COLUMN_WIDTHS = {
  compact: 'w-[75vw] sm:w-64 min-w-[256px]',
  default: 'w-[80vw] sm:w-80 min-w-[320px]',
  spacious: 'w-[85vw] sm:w-[340px] min-w-[340px]',
} as const;

const CARD_GAPS = {
  compact: 'space-y-1.5',
  default: 'space-y-3',
  spacious: 'space-y-3',
} as const;

// A column is mounted with every card in a `Draggable`. At 150+ cards the
// board holds ~1000 DOM nodes, and the horizontal snap container has to
// re-measure them on every scroll frame — which is what made mobile scrolling
// feel heavy. dnd rules out windowing here (@hello-pangea needs its own
// virtual API), so we render a page at a time and let the user ask for more.
const CARDS_PER_PAGE = 40;

export function KanbanColumn({
  status,
  issues,
  provided,
  isDraggingOver,
  onIssueClick,
  onContextMenu,
  selectedIds,
  onSelect,
  onCreateIssue,
  projectTags,
}: KanbanColumnProps) {
  const { t } = useTranslation();
  const density = useUIStore((s) => s.density);
  const [activeSubFilter, setActiveSubFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(CARDS_PER_PAGE);

  // Sub-status filter chips
  const subStatuses = useMemo(() => getSubStatuses(status.key), [status.key]);
  const subStatusCounts = useMemo(() => {
    if (!subStatuses) return null;
    const counts: Record<string, number> = { all: issues.length };
    for (const issue of issues) {
      const sub = deriveSubStatus(issue, status.key);
      counts[sub] = (counts[sub] || 0) + 1;
    }
    return counts;
  }, [subStatuses, issues, status.key]);

  const filteredIssues = useMemo(() => {
    if (!subStatuses || activeSubFilter === 'all') return issues;
    return issues.filter((issue) => deriveSubStatus(issue, status.key) === activeSubFilter);
  }, [issues, subStatuses, activeSubFilter, status.key]);

  // Switching sub-filter is a new list: don't carry over an expanded page.
  const selectSubFilter = useCallback((key: string) => {
    setActiveSubFilter(key);
    setVisibleCount(CARDS_PER_PAGE);
  }, []);

  const renderedIssues = useMemo(
    () => (filteredIssues.length > visibleCount ? filteredIssues.slice(0, visibleCount) : filteredIssues),
    [filteredIssues, visibleCount],
  );
  const hiddenCount = filteredIssues.length - renderedIssues.length;

  return (
    <div role="group" aria-label={`${status.label} — ${issues.length} issues`} className={cn('flex h-full flex-col shrink-0 snap-center', COLUMN_WIDTHS[density])}>
      {/* Column Header */}
      <div className={cn(
        'flex items-center justify-between px-1 border-b border-border/50',
        density === 'compact' ? 'mb-2 pb-1.5' : 'mb-3 pb-2',
      )}>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'rounded-full shrink-0',
              density === 'compact' ? 'h-2 w-2' : 'h-2.5 w-2.5',
            )}
            style={{ backgroundColor: status.color }}
            aria-hidden="true"
          />
          <span className={cn(
            'font-medium text-gray-900 dark:text-primary',
            density === 'compact' ? 'text-xs' : 'text-sm',
          )}>
            {status.label}
          </span>
          <span className={cn(
            'px-1.5 py-0.5 rounded-full bg-foreground/8 text-secondary font-medium',
            density === 'compact' ? 'text-[10px]' : 'text-xs',
          )} aria-label={`${issues.length} issues`}>
            {issues.length}
          </span>
        </div>
        <button
          onClick={() => onCreateIssue?.(status.key)}
          aria-label={`${t('kanban.addIssue')} in ${status.label}`}
          className="rounded-md p-1 text-gray-400 dark:text-secondary hover:text-gray-600 dark:hover:text-primary hover:bg-gray-50 dark:hover:bg-surface-hover transition-colors min-h-[28px] min-w-[28px] flex items-center justify-center"
        >
          <Plus size={density === 'compact' ? 14 : 16} aria-hidden="true" />
        </button>
      </div>

      {/* Sub-status filter chips */}
      {subStatuses && subStatusCounts && issues.length > 0 && (
        <div className={cn('flex items-center gap-1 px-1 flex-wrap', density === 'compact' ? 'mb-1.5' : 'mb-2')}>
          {subStatuses.map((sub) => {
            const count = subStatusCounts[sub.key] || 0;
            const isActive = activeSubFilter === sub.key;
            return (
              <button
                key={sub.key}
                onClick={() => selectSubFilter(sub.key)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
                  isActive
                    ? 'text-white'
                    : 'bg-transparent border border-border text-muted hover:text-secondary hover:border-gray-400 dark:hover:border-gray-500',
                )}
                style={isActive ? { backgroundColor: status.color } : undefined}
              >
                {sub.label}
                <span className={cn(
                  'text-[9px]',
                  isActive ? 'opacity-80' : 'opacity-60',
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Cards Container */}
      <div
        ref={provided.innerRef}
        {...provided.droppableProps}
        className={cn(
          'flex-1 overflow-y-auto rounded-lg p-1 pb-10 transition-colors',
          CARD_GAPS[density],
          isDraggingOver ? 'bg-surface' : '',
        )}
      >
        {renderedIssues.map((issue, index) => (
          <Draggable key={issue.id} draggableId={issue.id} index={index}>
            {(dragProvided, dragSnapshot) => (
              <KanbanCard
                issue={issue}
                provided={dragProvided}
                isDragging={dragSnapshot.isDragging}
                onClick={onIssueClick}
                onContextMenu={onContextMenu}
                selected={selectedIds?.has(issue.id)}
                onSelect={onSelect}
                projectTags={projectTags}
                index={index}
              />
            )}
          </Draggable>
        ))}
        {provided.placeholder}

        {hiddenCount > 0 && (
          <button
            onClick={() => setVisibleCount((c) => c + CARDS_PER_PAGE)}
            className="w-full rounded-lg border border-dashed border-border py-2 text-xs font-medium text-secondary hover:border-accent hover:text-primary hover:bg-surface transition-colors"
          >
            {t('kanban.loadMore', { count: Math.min(hiddenCount, CARDS_PER_PAGE), remaining: hiddenCount })}
          </button>
        )}

        {/* Empty state */}
        {filteredIssues.length === 0 && !isDraggingOver && (
          <button
            onClick={() => onCreateIssue?.(status.key)}
            className={cn(
              'w-full border border-dashed border-gray-200 dark:border-border rounded-lg flex flex-col items-center justify-center text-gray-400 dark:text-secondary hover:text-gray-600 dark:hover:text-primary hover:border-gray-300 dark:hover:border-accent hover:bg-white dark:hover:bg-surface transition-all group/empty',
              density === 'compact' ? 'h-20' : 'h-32',
            )}
          >
            <Plus size={20} className="mb-2 text-gray-300 dark:text-muted group-hover/empty:text-gray-500 dark:group-hover/empty:text-secondary transition-colors" />
            <span className="text-sm font-medium">{t('kanban.addIssue')}</span>
          </button>
        )}
      </div>
    </div>
  );
}
