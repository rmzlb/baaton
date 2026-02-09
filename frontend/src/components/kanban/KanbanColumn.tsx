import { Draggable, type DroppableProvided } from '@hello-pangea/dnd';
import { Plus } from 'lucide-react';
import { KanbanCard } from './KanbanCard';
import type { Issue, ProjectStatus } from '@/lib/types';

interface KanbanColumnProps {
  status: ProjectStatus;
  issues: Issue[];
  provided: DroppableProvided;
  isDraggingOver: boolean;
  onIssueClick: (issue: Issue) => void;
  onCreateIssue?: (statusKey: string) => void;
}

export function KanbanColumn({
  status,
  issues,
  provided,
  isDraggingOver,
  onIssueClick,
  onCreateIssue,
}: KanbanColumnProps) {
  return (
    <div className="flex h-full w-72 min-w-[280px] flex-col">
      {/* Column Header */}
      <div className="flex items-center justify-between px-2 pb-3">
        <div className="flex items-center gap-2">
          <div
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: status.color }}
          />
          <span className="text-sm font-medium text-[#fafafa]">
            {status.label}
          </span>
          <span className="rounded-full bg-[#1f1f1f] px-2 py-0.5 text-xs text-[#a1a1aa] font-mono">
            {issues.length}
          </span>
        </div>
        <button
          onClick={() => onCreateIssue?.(status.key)}
          className="rounded-md p-1 text-[#a1a1aa] hover:bg-[#1f1f1f] hover:text-[#fafafa] transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Cards Container */}
      <div
        ref={provided.innerRef}
        {...provided.droppableProps}
        className={`flex-1 space-y-2 overflow-y-auto rounded-lg p-1 transition-colors ${
          isDraggingOver ? 'bg-[#141414]' : ''
        }`}
      >
        {issues.map((issue, index) => (
          <Draggable key={issue.id} draggableId={issue.id} index={index}>
            {(dragProvided, dragSnapshot) => (
              <KanbanCard
                issue={issue}
                provided={dragProvided}
                isDragging={dragSnapshot.isDragging}
                onClick={() => onIssueClick(issue)}
              />
            )}
          </Draggable>
        ))}
        {provided.placeholder}

        {/* Empty state */}
        {issues.length === 0 && !isDraggingOver && (
          <button
            onClick={() => onCreateIssue?.(status.key)}
            className="flex h-24 w-full items-center justify-center rounded-lg border border-dashed border-[#262626] text-xs text-[#a1a1aa] hover:border-[#f59e0b] hover:text-[#f59e0b] transition-colors min-h-[44px]"
          >
            <Plus size={14} className="mr-1" />
            Add issue
          </button>
        )}
      </div>
    </div>
  );
}
