import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StatusStripColumn {
  id: string;       // IssueStatus key
  label: string;    // "Draft", "Backlog", etc.
  count: number;
  color: string;    // hex color string
}

interface StatusStripProps {
  columns: StatusStripColumn[];
  visibleColumnIds: string[];       // columns currently intersecting the scroll viewport
  onColumnClick: (columnId: string) => void;
}

/**
 * Persistent horizontal navigation strip that sits above the kanban columns.
 *
 * - Columns currently in the viewport get a highlighted background.
 * - Off-screen columns with tickets show an orange count + scroll-hint arrow.
 * - Click any item → smooth-scroll that column into view.
 * - The strip itself scrolls horizontally (hidden scrollbar) when cramped.
 */
export function KanbanStatusStrip({
  columns,
  visibleColumnIds,
  onColumnClick,
}: StatusStripProps) {
  const visibleSet = new Set(visibleColumnIds);

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 overflow-x-auto border-b border-border bg-surface',
        'px-3 py-1 shrink-0',
        // Hide scrollbar cross-browser
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      )}
    >
      {columns.map((col) => {
        const isVisible = visibleSet.has(col.id);
        const isOffScreen = !isVisible;
        const hasOffScreenTickets = isOffScreen && col.count > 0;

        return (
          <button
            key={col.id}
            onClick={() => onColumnClick(col.id)}
            title={`Go to ${col.label}`}
            aria-label={`${col.label}: ${col.count} issues${isOffScreen ? ' (off screen)' : ''}`}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium',
              'transition-colors shrink-0 whitespace-nowrap',
              isVisible
                ? 'bg-surface-hover text-primary'
                : 'text-secondary hover:text-primary hover:bg-surface-hover/60',
            )}
          >
            {/* Status color dot */}
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ backgroundColor: col.color }}
              aria-hidden="true"
            />

            {/* Column label */}
            {col.label}

            {/* Ticket count — orange when off-screen and non-zero */}
            <span
              className={cn(
                'tabular-nums',
                col.count === 0
                  ? 'text-muted'
                  : isOffScreen
                  ? 'text-orange-400 font-semibold'
                  : 'text-secondary',
              )}
            >
              {col.count}
            </span>

            {/* Scroll-hint chevron for off-screen columns that still have tickets */}
            {hasOffScreenTickets && (
              <ChevronRight
                size={11}
                className="text-orange-400 shrink-0 -ml-0.5"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
