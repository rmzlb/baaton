import { useParams } from 'react-router-dom';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import type { IssueStatus, ProjectStatus } from '@/lib/types';

// Default statuses (will come from API)
const DEFAULT_STATUSES: ProjectStatus[] = [
  { key: 'backlog', label: 'Backlog', color: '#6b7280', hidden: true },
  { key: 'todo', label: 'Todo', color: '#3b82f6', hidden: false },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b', hidden: false },
  { key: 'in_review', label: 'In Review', color: '#8b5cf6', hidden: false },
  { key: 'done', label: 'Done', color: '#22c55e', hidden: false },
  { key: 'cancelled', label: 'Cancelled', color: '#ef4444', hidden: true },
];

export function ProjectBoard() {
  const { slug } = useParams<{ slug: string }>();

  // TODO: Fetch project + issues from API
  const handleMoveIssue = (issueId: string, newStatus: IssueStatus, newPosition: number) => {
    console.log('Move issue:', issueId, newStatus, newPosition);
    // TODO: API call to update issue
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#262626] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-[#fafafa]">{slug}</h1>
          <p className="text-xs text-[#a1a1aa] font-mono uppercase tracking-wider">
            kanban view
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Filter bar will go here */}
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-hidden">
        <KanbanBoard
          statuses={DEFAULT_STATUSES}
          issues={[]} // TODO: from API
          onMoveIssue={handleMoveIssue}
          onIssueClick={(issue) => console.log('Open:', issue.id)}
        />
      </div>
    </div>
  );
}
