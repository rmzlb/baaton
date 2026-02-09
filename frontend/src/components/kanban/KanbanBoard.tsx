import { useCallback, useState, useMemo } from 'react';
import {
  DragDropContext,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd';
import { Search, SlidersHorizontal } from 'lucide-react';
import { KanbanColumn } from './KanbanColumn';
import { useIssuesStore } from '@/stores/issues';
import { cn } from '@/lib/utils';
import type { Issue, IssueStatus, ProjectStatus } from '@/lib/types';

type FilterTab = 'active' | 'all' | 'backlog' | 'cancelled';
type SortMode = 'manual' | 'priority' | 'created' | 'updated';

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

interface KanbanBoardProps {
  statuses: ProjectStatus[];
  issues: Issue[];
  onMoveIssue: (issueId: string, newStatus: IssueStatus, newPosition: number) => void;
  onIssueClick: (issue: Issue) => void;
  onCreateIssue?: (statusKey: string) => void;
}

export function KanbanBoard({ statuses, issues, onMoveIssue, onIssueClick, onCreateIssue }: KanbanBoardProps) {
  const moveIssue = useIssuesStore((s) => s.moveIssue);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [sortMode, setSortMode] = useState<SortMode>('manual');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSort, setShowSort] = useState(false);

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

  // Filter issues by search query
  const filteredIssues = useMemo(() => {
    if (!searchQuery) return issues;
    const q = searchQuery.toLowerCase();
    return issues.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.display_id.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [issues, searchQuery]);

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
                />
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}
