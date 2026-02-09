import { useCallback } from 'react';
import {
  DragDropContext,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd';
import { KanbanColumn } from './KanbanColumn';
import { useIssuesStore } from '@/stores/issues';
import type { Issue, IssueStatus, ProjectStatus } from '@/lib/types';

interface KanbanBoardProps {
  statuses: ProjectStatus[];
  issues: Issue[];
  onMoveIssue: (issueId: string, newStatus: IssueStatus, newPosition: number) => void;
  onIssueClick: (issue: Issue) => void;
}

export function KanbanBoard({ statuses, issues, onMoveIssue, onIssueClick }: KanbanBoardProps) {
  const moveIssue = useIssuesStore((s) => s.moveIssue);

  const visibleStatuses = statuses.filter((s) => !s.hidden);

  const issuesByStatus = visibleStatuses.reduce(
    (acc, status) => {
      acc[status.key] = issues
        .filter((i) => i.status === status.key)
        .sort((a, b) => a.position - b.position);
      return acc;
    },
    {} as Record<string, Issue[]>,
  );

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

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex h-full gap-4 overflow-x-auto p-6">
        {visibleStatuses.map((status) => (
          <Droppable key={status.key} droppableId={status.key}>
            {(provided, snapshot) => (
              <KanbanColumn
                status={status}
                issues={issuesByStatus[status.key] || []}
                provided={provided}
                isDraggingOver={snapshot.isDraggingOver}
                onIssueClick={onIssueClick}
              />
            )}
          </Droppable>
        ))}
      </div>
    </DragDropContext>
  );
}
