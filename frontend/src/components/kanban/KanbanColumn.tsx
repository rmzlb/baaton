import { Draggable, type DroppableProvided } from '@hello-pangea/dnd';
import { Plus } from 'lucide-react';
import { KanbanCard } from './KanbanCard';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Issue, ProjectStatus, ProjectTag } from '@/lib/types';

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

  return (
    <div role="group" aria-label={`${status.label} — ${issues.length} issues`} className={cn('flex h-full flex-col shrink-0 snap-center', COLUMN_WIDTHS[density])}>
      {/* Column Header */}
      <div className={cn(
        'flex items-center justify-between px-1',
        density === 'compact' ? 'mb-2' : 'mb-3',
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
            'px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-surface-hover text-gray-500 dark:text-secondary font-medium',
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
        {issues.map((issue, index) => (
          <Draggable key={issue.id} draggableId={issue.id} index={index}>
            {(dragProvided, dragSnapshot) => (
              <KanbanCard
                issue={issue}
                provided={dragProvided}
                isDragging={dragSnapshot.isDragging}
                onClick={() => onIssueClick(issue)}
                onContextMenu={onContextMenu}
                selected={selectedIds?.has(issue.id)}
                onSelect={onSelect}
                projectTags={projectTags}
              />
            )}
          </Draggable>
        ))}
        {provided.placeholder}

        {/* Empty state */}
        {issues.length === 0 && !isDraggingOver && (
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
