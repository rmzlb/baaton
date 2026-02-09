import { Draggable, type DroppableProvided } from '@hello-pangea/dnd';
import { Plus } from '@phosphor-icons/react';
import { KanbanCard } from './KanbanCard';
import type { Issue, ProjectStatus } from '@/lib/types';

interface KanbanColumnProps {
  status: ProjectStatus;
  issues: Issue[];
  provided: DroppableProvided;
  isDraggingOver: boolean;
  onIssueClick: (issue: Issue) => void;
}

export function KanbanColumn({
  status,
  issues,
  provided,
  isDraggingOver,
  onIssueClick,
}: KanbanColumnProps) {
  return (
    <div className="flex h-full w-72 min-w-72 flex-col">
      {/* Column Header */}
      <div className="flex items-center justify-between px-2 pb-3">
        <div className="flex items-center gap-2">
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: status.color }}
          />
          <span className="text-sm font-medium text-[#fafafa]">
            {status.label}
          </span>
          <span className="rounded-full bg-[#1f1f1f] px-2 py-0.5 text-xs text-[#a1a1aa] font-mono">
            {issues.length}
          </span>
        </div>
        <button className="rounded-md p-1 text-[#a1a1aa] hover:bg-[#1f1f1f] hover:text-[#fafafa] transition-colors">
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
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-[#262626] text-xs text-[#a1a1aa]">
            No issues
          </div>
        )}
      </div>
    </div>
  );
}
