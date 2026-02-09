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
  onCreateIssue?: (statusKey: string) => void;
  projectTags?: ProjectTag[];
}

const COLUMN_WIDTHS = {
  compact: 'w-60 min-w-[240px]',
  default: 'w-72 min-w-[280px]',
  spacious: 'w-80 min-w-[320px]',
} as const;

const CARD_GAPS = {
  compact: 'space-y-1',
  default: 'space-y-2',
  spacious: 'space-y-3',
} as const;

export function KanbanColumn({
  status,
  issues,
  provided,
  isDraggingOver,
  onIssueClick,
  onCreateIssue,
  projectTags,
}: KanbanColumnProps) {
  const { t } = useTranslation();
  const density = useUIStore((s) => s.density);

  return (
    <div className={cn('flex h-full flex-col', COLUMN_WIDTHS[density])}>
      {/* Column Header */}
      <div className={cn(
        'flex items-center justify-between px-2',
        density === 'compact' ? 'pb-2' : 'pb-3',
      )}>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'rounded-full shrink-0',
              density === 'compact' ? 'h-2 w-2' : 'h-2.5 w-2.5',
            )}
            style={{ backgroundColor: status.color }}
          />
          <span className={cn(
            'font-medium text-primary',
            density === 'compact' ? 'text-xs' : 'text-sm',
          )}>
            {status.label}
          </span>
          <span className={cn(
            'rounded-full bg-surface-hover px-2 py-0.5 text-secondary font-mono',
            density === 'compact' ? 'text-[10px]' : 'text-xs',
          )}>
            {issues.length}
          </span>
        </div>
        <button
          onClick={() => onCreateIssue?.(status.key)}
          className="rounded-md p-1 text-secondary hover:bg-surface-hover hover:text-primary transition-colors min-h-[28px] min-w-[28px] flex items-center justify-center"
        >
          <Plus size={density === 'compact' ? 14 : 16} />
        </button>
      </div>

      {/* Cards Container */}
      <div
        ref={provided.innerRef}
        {...provided.droppableProps}
        className={cn(
          'flex-1 overflow-y-auto rounded-lg p-1 transition-colors',
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
              'flex w-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-secondary hover:border-accent hover:text-accent transition-colors',
              density === 'compact' ? 'h-16' : density === 'spacious' ? 'h-28' : 'h-24',
            )}
          >
            <Plus size={14} className="mr-1" />
            {t('kanban.addIssue')}
          </button>
        )}
      </div>
    </div>
  );
}
