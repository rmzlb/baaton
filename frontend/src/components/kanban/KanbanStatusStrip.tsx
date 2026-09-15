import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { OffscreenSide } from './layout';

export interface StatusStripColumn {
  id: string;
  label: string;
  count: number;
  color: string;
}

interface StatusStripProps {
  columns: StatusStripColumn[];
  offscreenColumns: Record<string, OffscreenSide>;
  onColumnClick: (columnId: string) => void;
}

/** All statuses stay discoverable: wrap rather than creating another hidden scroller. */
export function KanbanStatusStrip({ columns, offscreenColumns, onColumnClick }: StatusStripProps) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('kanban.statusNavigation', { defaultValue: 'Board columns' })}
      className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border bg-surface px-3 py-1"
    >
      {columns.map((col) => {
        const side = offscreenColumns[col.id];
        const hasOffscreenTickets = !!side && col.count > 0;
        const Arrow = side === 'left' ? ChevronLeft : ChevronRight;
        return (
          <button
            key={col.id}
            type="button"
            onClick={() => onColumnClick(col.id)}
            title={t('kanban.goToColumn', { defaultValue: 'Go to {{status}}', status: col.label })}
            aria-label={t('kanban.columnIssues', {
              defaultValue: '{{status}}: {{count}} issues',
              status: col.label,
              count: col.count,
            })}
            className={cn(
              'flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium',
              'transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
              side ? 'text-secondary hover:bg-surface-hover hover:text-primary' : 'bg-surface-hover text-primary',
            )}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: col.color }} aria-hidden="true" />
            {col.label}
            <span className={cn('tabular-nums', col.count === 0 ? 'text-muted' : hasOffscreenTickets ? 'font-semibold text-accent' : 'text-secondary')}>
              {col.count}
            </span>
            {hasOffscreenTickets && <Arrow size={12} className="shrink-0 text-accent" aria-hidden="true" />}
          </button>
        );
      })}
    </nav>
  );
}
