import { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import {
  DragDropContext,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  Search, SlidersHorizontal, X, ArrowUp, ArrowDown, Minus, AlertTriangle,
  Tag, User, ChevronDown,
} from 'lucide-react';
import { KanbanColumn } from './KanbanColumn';
import { useIssuesStore } from '@/stores/issues';
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

interface KanbanBoardProps {
  statuses: ProjectStatus[];
  issues: Issue[];
  onMoveIssue: (issueId: string, newStatus: IssueStatus, newPosition: number) => void;
  onIssueClick: (issue: Issue) => void;
  onCreateIssue?: (statusKey: string) => void;
  projectTags?: ProjectTag[];
}

export function KanbanBoard({ statuses, issues, onMoveIssue, onIssueClick, onCreateIssue, projectTags = [] }: KanbanBoardProps) {
  const moveIssue = useIssuesStore((s) => s.moveIssue);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [sortMode, setSortMode] = useState<SortMode>('manual');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSort, setShowSort] = useState(false);

  // Enhanced filters
  const [selectedPriorities, setSelectedPriorities] = useState<IssuePriority[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);

  const hasActiveFilters = selectedPriorities.length > 0 || selectedTags.length > 0 || selectedAssignees.length > 0;

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

    return result;
  }, [issues, searchQuery, selectedPriorities, selectedTags, selectedAssignees]);

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

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination, source } = result;

      if (!destination) return;
      if (
        destination.droppableId === source.droppableId &&
        destination.index === source.index
      )
        return;

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

      // API call
      onMoveIssue(draggableId, newStatus, newPosition);
    },
    [issuesByStatus, moveIssue, onMoveIssue],
  );

  const clearAllFilters = () => {
    setSelectedPriorities([]);
    setSelectedTags([]);
    setSelectedAssignees([]);
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

  const filterTabs: { key: FilterTab; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'all', label: 'All' },
    { key: 'backlog', label: 'Backlog' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  const sortOptions: { key: SortMode; label: string }[] = [
    { key: 'manual', label: 'Manual' },
    { key: 'priority', label: 'Priority' },
    { key: 'created', label: 'Created' },
    { key: 'updated', label: 'Updated' },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#262626] px-4 md:px-6 py-2">
        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#555]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter issues…"
            className="h-8 w-40 sm:w-48 rounded-md border border-[#262626] bg-[#141414] pl-8 pr-3 text-xs text-[#fafafa] placeholder-[#555] outline-none focus:border-[#f59e0b] transition-colors"
          />
        </div>

        {/* Status Tabs */}
        <div className="flex items-center rounded-md border border-[#262626] bg-[#141414] p-0.5">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilterTab(tab.key)}
              className={cn(
                'rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-colors min-h-[28px]',
                filterTab === tab.key
                  ? 'bg-[#1f1f1f] text-[#fafafa]'
                  : 'text-[#666] hover:text-[#a1a1aa]',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Priority Filter Dropdown */}
        <FilterDropdown
          icon={<AlertTriangle size={12} />}
          label="Priority"
          count={selectedPriorities.length}
        >
          {PRIORITY_CONFIG.map((p) => (
            <button
              key={p.key}
              onClick={() => togglePriority(p.key)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                selectedPriorities.includes(p.key)
                  ? 'text-[#fafafa] bg-[#1f1f1f]'
                  : 'text-[#a1a1aa] hover:bg-[#1f1f1f]',
              )}
            >
              <p.icon size={12} style={{ color: p.color }} />
              {p.label}
              {selectedPriorities.includes(p.key) && (
                <span className="ml-auto text-[#f59e0b]">✓</span>
              )}
            </button>
          ))}
        </FilterDropdown>

        {/* Tags Filter Dropdown */}
        {uniqueTags.length > 0 && (
          <FilterDropdown
            icon={<Tag size={12} />}
            label="Tags"
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
                      ? 'text-[#fafafa] bg-[#1f1f1f]'
                      : 'text-[#a1a1aa] hover:bg-[#1f1f1f]',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  {tag}
                  {selectedTags.includes(tag) && (
                    <span className="ml-auto text-[#f59e0b]">✓</span>
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
            label="Assignee"
            count={selectedAssignees.length}
          >
            {uniqueAssignees.map((a) => (
              <button
                key={a}
                onClick={() => toggleAssignee(a)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                  selectedAssignees.includes(a)
                    ? 'text-[#fafafa] bg-[#1f1f1f]'
                    : 'text-[#a1a1aa] hover:bg-[#1f1f1f]',
                )}
              >
                <div className="h-5 w-5 rounded-full bg-[#262626] flex items-center justify-center text-[8px] font-mono text-[#a1a1aa]">
                  {a.slice(0, 2).toUpperCase()}
                </div>
                <span className="truncate">{a}</span>
                {selectedAssignees.includes(a) && (
                  <span className="ml-auto text-[#f59e0b]">✓</span>
                )}
              </button>
            ))}
          </FilterDropdown>
        )}

        {/* Clear All */}
        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-[#f59e0b] hover:bg-[#f59e0b]/10 transition-colors"
          >
            <X size={12} />
            Clear all
          </button>
        )}

        {/* Sort Dropdown */}
        <div className="relative ml-auto">
          <button
            onClick={() => setShowSort(!showSort)}
            className="flex items-center gap-1.5 rounded-md border border-[#262626] bg-[#141414] px-2.5 py-1.5 text-xs text-[#a1a1aa] hover:border-[#333] hover:text-[#fafafa] transition-colors min-h-[32px]"
          >
            <SlidersHorizontal size={12} />
            <span className="hidden sm:inline">{sortOptions.find((s) => s.key === sortMode)?.label}</span>
          </button>
          {showSort && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSort(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-lg border border-[#262626] bg-[#141414] py-1 shadow-xl">
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
                        ? 'text-[#fafafa] bg-[#1f1f1f]'
                        : 'text-[#a1a1aa] hover:bg-[#1f1f1f]',
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
        <div className="flex flex-1 gap-4 overflow-x-auto p-4 md:p-6">
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
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors min-h-[32px]',
          count > 0
            ? 'border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#f59e0b]'
            : 'border-[#262626] bg-[#141414] text-[#a1a1aa] hover:border-[#333] hover:text-[#fafafa]',
        )}
      >
        {icon}
        {label}
        {count > 0 && (
          <span className="ml-0.5 rounded-full bg-[#f59e0b] px-1.5 py-0 text-[9px] text-black font-bold">
            {count}
          </span>
        )}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-[#262626] bg-[#141414] py-1 shadow-xl max-h-64 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}
