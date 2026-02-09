import { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import {
  DragDropContext,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  Search, SlidersHorizontal, X, ArrowUp, ArrowDown, Minus, AlertTriangle,
  Tag, User, ChevronDown, Layers,
} from 'lucide-react';
import { KanbanColumn } from './KanbanColumn';
import { useIssuesStore } from '@/stores/issues';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Issue, IssueStatus, IssuePriority, ProjectStatus, ProjectTag } from '@/lib/types';

type FilterTab = 'active' | 'all' | 'backlog' | 'cancelled';
type SortMode = 'manual' | 'priority' | 'created' | 'updated';

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const PRIORITY_CONFIG: { key: IssuePriority; label: string; color: string; icon: typeof ArrowUp }[] = [
  { key: 'urgent', label: 'Urgent', color: '#ef4444', icon: AlertTriangle },
  { key: 'high', label: 'High', color: '#f97316', icon: ArrowUp },
  { key: 'medium', label: 'Medium', color: '#eab308', icon: Minus },
  { key: 'low', label: 'Low', color: '#6b7280', icon: ArrowDown },
];

const CATEGORY_CONFIG: { key: string; label: string; color: string }[] = [
  { key: 'FRONT', label: 'Frontend', color: '#3b82f6' },
  { key: 'BACK', label: 'Backend', color: '#22c55e' },
  { key: 'API', label: 'API', color: '#8b5cf6' },
  { key: 'DB', label: 'Database', color: '#f97316' },
];

interface KanbanBoardProps {
  statuses: ProjectStatus[];
  issues: Issue[];
  onMoveIssue: (issueId: string, newStatus: IssueStatus, newPosition: number) => void;
  onIssueClick: (issue: Issue) => void;
  onCreateIssue?: (statusKey: string) => void;
  projectTags?: ProjectTag[];
}

export function KanbanBoard({ statuses, issues, onMoveIssue, onIssueClick, onCreateIssue, projectTags = [] }: KanbanBoardProps) {
  const { t } = useTranslation();
  const moveIssue = useIssuesStore((s) => s.moveIssue);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [sortMode, setSortMode] = useState<SortMode>('manual');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSort, setShowSort] = useState(false);

  // Enhanced filters
  const [selectedPriorities, setSelectedPriorities] = useState<IssuePriority[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const hasActiveFilters = selectedPriorities.length > 0 || selectedTags.length > 0 || selectedAssignees.length > 0 || selectedCategories.length > 0;

  // Get unique assignees from issues
  const uniqueAssignees = useMemo(() => {
    const ids = new Set<string>();
    issues.forEach((i) => i.assignee_ids.forEach((a) => ids.add(a)));
    return Array.from(ids);
  }, [issues]);

  // Get unique tags from issues
  const uniqueTags = useMemo(() => {
    const tags = new Set<string>();
    issues.forEach((i) => i.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [issues]);

  // Determine visible statuses based on filter tab
  const visibleStatuses = useMemo(() => {
    switch (filterTab) {
      case 'active':
        return statuses.filter((s) => !s.hidden);
      case 'all':
        return statuses;
      case 'backlog':
        return statuses.filter((s) => s.key === 'backlog');
      case 'cancelled':
        return statuses.filter((s) => s.key === 'cancelled');
      default:
        return statuses.filter((s) => !s.hidden);
    }
  }, [statuses, filterTab]);

  // Filter issues by all criteria
  const filteredIssues = useMemo(() => {
    let result = issues;

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.display_id.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Priority filter (OR within)
    if (selectedPriorities.length > 0) {
      result = result.filter((i) => i.priority && selectedPriorities.includes(i.priority));
    }

    // Tag filter (OR within)
    if (selectedTags.length > 0) {
      result = result.filter((i) => i.tags.some((t) => selectedTags.includes(t)));
    }

    // Assignee filter (OR within)
    if (selectedAssignees.length > 0) {
      result = result.filter((i) => i.assignee_ids.some((a) => selectedAssignees.includes(a)));
    }

    // Category filter (OR within)
    if (selectedCategories.length > 0) {
      result = result.filter((i) => (i.category || []).some((c) => selectedCategories.includes(c.toUpperCase())));
    }

    return result;
  }, [issues, searchQuery, selectedPriorities, selectedTags, selectedAssignees, selectedCategories]);

  // Sort function
  const sortIssues = useCallback(
    (issueList: Issue[]): Issue[] => {
      const sorted = [...issueList];
      switch (sortMode) {
        case 'priority':
          return sorted.sort(
            (a, b) =>
              (PRIORITY_ORDER[a.priority || 'low'] ?? 4) -
              (PRIORITY_ORDER[b.priority || 'low'] ?? 4),
          );
        case 'created':
          return sorted.sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
        case 'updated':
          return sorted.sort(
            (a, b) =>
              new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
          );
        case 'manual':
        default:
          return sorted.sort((a, b) => a.position - b.position);
      }
    },
    [sortMode],
  );

  const issuesByStatus = useMemo(() => {
    return visibleStatuses.reduce(
      (acc, status) => {
        const columnIssues = filteredIssues.filter((i) => i.status === status.key);
        acc[status.key] = sortIssues(columnIssues);
        return acc;
      },
      {} as Record<string, Issue[]>,
    );
  }, [visibleStatuses, filteredIssues, sortIssues]);

  // Announce DnD results to screen readers
  const announceToScreenReader = useCallback((message: string) => {
    const announcer = document.getElementById('a11y-announcer');
    if (announcer) {
      announcer.textContent = message;
    }
  }, []);

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result;

      if (!destination) {
        announceToScreenReader('Item drop cancelled.');
        return;
      }
      if (
        destination.droppableId === source.droppableId &&
        destination.index === source.index
      ) {
        return;
      }

      const newStatus = destination.droppableId as IssueStatus;
      const columnIssues = issuesByStatus[newStatus] || [];

      // Calculate new position
      let newPosition: number;
      if (columnIssues.length === 0) {
        newPosition = 1000;
      } else if (destination.index === 0) {
        newPosition = columnIssues[0].position / 2;
      } else if (destination.index >= columnIssues.length) {
        newPosition = columnIssues[columnIssues.length - 1].position + 1000;
      } else {
        const before = columnIssues[destination.index - 1].position;
        const after = columnIssues[destination.index].position;
        newPosition = (before + after) / 2;
      }

      // Optimistic update
      moveIssue(draggableId, newStatus, newPosition);

      // Announce status change
      const movedIssue = issues.find((i) => i.id === draggableId);
      const statusLabel = visibleStatuses.find((s) => s.key === newStatus)?.label || newStatus;
      announceToScreenReader(
        `Issue ${movedIssue?.display_id || ''} moved to ${statusLabel}, position ${destination.index + 1}.`,
      );

      // API call
      onMoveIssue(draggableId, newStatus, newPosition);
    },
    [issuesByStatus, moveIssue, onMoveIssue, announceToScreenReader, issues, visibleStatuses],
  );

  const clearAllFilters = () => {
    setSelectedPriorities([]);
    setSelectedTags([]);
    setSelectedAssignees([]);
    setSelectedCategories([]);
    setSearchQuery('');
  };

  const togglePriority = (p: IssuePriority) => {
    setSelectedPriorities((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const toggleTag = (t: string) => {
    setSelectedTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  };

  const toggleAssignee = (a: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a],
    );
  };

  const toggleCategory = (c: string) => {
    setSelectedCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  const filterTabs: { key: FilterTab; label: string }[] = [
    { key: 'active', label: t('kanban.active') },
    { key: 'all', label: t('kanban.all') },
    { key: 'backlog', label: t('kanban.backlog') },
    { key: 'cancelled', label: t('kanban.cancelled') },
  ];

  const sortOptions: { key: SortMode; label: string }[] = [
    { key: 'manual', label: t('kanban.manual') },
    { key: 'priority', label: t('kanban.priority') },
    { key: 'created', label: t('kanban.created') },
    { key: 'updated', label: t('kanban.updated') },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5 md:gap-2 border-b border-border px-3 md:px-6 py-2 overflow-x-auto">
        {/* Search */}
        <div className="relative shrink-0">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('kanban.filterIssues')}
            aria-label={t('kanban.filterIssues') || 'Filter issues'}
            className="h-8 w-32 sm:w-48 rounded-md border border-border bg-surface pl-8 pr-3 text-xs text-primary placeholder-muted outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Status Tabs */}
        <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilterTab(tab.key)}
              className={cn(
                'rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-colors min-h-[28px]',
                filterTab === tab.key
                  ? 'bg-surface-hover text-primary'
                  : 'text-muted hover:text-secondary',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Priority Filter Dropdown */}
        <FilterDropdown
          icon={<AlertTriangle size={12} />}
          label={t('kanban.priority')}
          count={selectedPriorities.length}
        >
          {PRIORITY_CONFIG.map((p) => (
            <button
              key={p.key}
              onClick={() => togglePriority(p.key)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                selectedPriorities.includes(p.key)
                  ? 'text-primary bg-surface-hover'
                  : 'text-secondary hover:bg-surface-hover',
              )}
            >
              <p.icon size={12} style={{ color: p.color }} />
              {p.label}
              {selectedPriorities.includes(p.key) && (
                <span className="ml-auto text-accent">✓</span>
              )}
            </button>
          ))}
        </FilterDropdown>

        {/* Category Filter Dropdown */}
        <FilterDropdown
          icon={<Layers size={12} />}
          label={t('kanban.category')}
          count={selectedCategories.length}
        >
          {CATEGORY_CONFIG.map((c) => (
            <button
              key={c.key}
              onClick={() => toggleCategory(c.key)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                selectedCategories.includes(c.key)
                  ? 'text-primary bg-surface-hover'
                  : 'text-secondary hover:bg-surface-hover',
              )}
            >
              <span
                className="h-2.5 w-2.5 rounded shrink-0"
                style={{ backgroundColor: c.color }}
              />
              {c.label}
              {selectedCategories.includes(c.key) && (
                <span className="ml-auto text-accent">✓</span>
              )}
            </button>
          ))}
        </FilterDropdown>

        {/* Tags Filter Dropdown */}
        {uniqueTags.length > 0 && (
          <FilterDropdown
            icon={<Tag size={12} />}
            label={t('kanban.tags')}
            count={selectedTags.length}
          >
            {uniqueTags.map((tag) => {
              const tagObj = projectTags.find((t) => t.name === tag);
              const color = tagObj?.color || '#6b7280';
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                    selectedTags.includes(tag)
                      ? 'text-primary bg-surface-hover'
                      : 'text-secondary hover:bg-surface-hover',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  {tag}
                  {selectedTags.includes(tag) && (
                    <span className="ml-auto text-accent">✓</span>
                  )}
                </button>
              );
            })}
          </FilterDropdown>
        )}

        {/* Assignee Filter Dropdown */}
        {uniqueAssignees.length > 0 && (
          <FilterDropdown
            icon={<User size={12} />}
            label={t('kanban.assignee')}
            count={selectedAssignees.length}
          >
            {uniqueAssignees.map((a) => (
              <button
                key={a}
                onClick={() => toggleAssignee(a)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                  selectedAssignees.includes(a)
                    ? 'text-primary bg-surface-hover'
                    : 'text-secondary hover:bg-surface-hover',
                )}
              >
                <div className="h-5 w-5 rounded-full bg-border flex items-center justify-center text-[8px] font-mono text-secondary">
                  {a.slice(0, 2).toUpperCase()}
                </div>
                <span className="truncate">{a}</span>
                {selectedAssignees.includes(a) && (
                  <span className="ml-auto text-accent">✓</span>
                )}
              </button>
            ))}
          </FilterDropdown>
        )}

        {/* Clear All */}
        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-accent hover:bg-accent/10 transition-colors"
          >
            <X size={12} />
            {t('kanban.clearAll')}
          </button>
        )}

        {/* Sort Dropdown */}
        <div className="relative ml-auto">
          <button
            onClick={() => setShowSort(!showSort)}
            aria-expanded={showSort}
            aria-haspopup="listbox"
            aria-label={`Sort by: ${sortOptions.find((s) => s.key === sortMode)?.label}`}
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-secondary hover:border-border hover:text-primary transition-colors min-h-[32px]"
          >
            <SlidersHorizontal size={12} aria-hidden="true" />
            <span className="hidden sm:inline">{sortOptions.find((s) => s.key === sortMode)?.label}</span>
          </button>
          {showSort && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSort(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-lg border border-border bg-surface py-1 shadow-xl">
                {sortOptions.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setSortMode(opt.key);
                      setShowSort(false);
                    }}
                    className={cn(
                      'flex w-full items-center px-3 py-2 text-xs transition-colors',
                      sortMode === opt.key
                        ? 'text-primary bg-surface-hover'
                        : 'text-secondary hover:bg-surface-hover',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Board */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex flex-1 gap-3 md:gap-4 overflow-x-auto p-3 md:p-6 snap-x snap-mandatory md:snap-none scroll-smooth">
          {visibleStatuses.map((status) => (
            <Droppable key={status.key} droppableId={status.key}>
              {(provided, snapshot) => (
                <KanbanColumn
                  status={status}
                  issues={issuesByStatus[status.key] || []}
                  provided={provided}
                  isDraggingOver={snapshot.isDraggingOver}
                  onIssueClick={onIssueClick}
                  onCreateIssue={onCreateIssue}
                  projectTags={projectTags}
                />
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}

/* ── Filter Dropdown Component ─────────────────────── */

function FilterDropdown({
  icon,
  label,
  count,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors min-h-[32px]',
          count > 0
            ? 'border-accent/30 bg-accent/10 text-accent'
            : 'border-border bg-surface text-secondary hover:border-border hover:text-primary',
        )}
      >
        <span aria-hidden="true">{icon}</span>
        {label}
        {count > 0 && (
          <span className="ml-0.5 rounded-full bg-accent px-1.5 py-0 text-[9px] text-black font-bold" aria-label={`${count} selected`}>
            {count}
          </span>
        )}
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {open && (
        <div role="listbox" aria-label={label} className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-border bg-surface py-1 shadow-xl max-h-64 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}
