import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-surface-hover', className)} />;
}

/* ── Kanban Board Skeleton ─────────────────────── */

export function KanbanBoardSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Filter bar skeleton */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-2">
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-8 w-56 rounded-md" />
        <div className="ml-auto">
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>

      {/* Columns */}
      <div className="flex flex-1 gap-4 overflow-hidden p-6">
        {[0, 1, 2, 3].map((col) => (
          <div key={col} className="flex w-72 min-w-[280px] shrink-0 flex-col">
            {/* Column header */}
            <div className="flex items-center gap-2 pb-3">
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>

            {/* Cards */}
            <div className="flex-1 space-y-2">
              {Array.from({ length: col === 0 ? 3 : col === 1 ? 2 : col === 2 ? 4 : 1 }).map(
                (_, i) => (
                  <KanbanCardSkeleton key={i} />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KanbanCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
      {/* Top row: ID + priority */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3.5 w-3.5 rounded-sm" />
      </div>
      {/* Title */}
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      {/* Bottom row */}
      <div className="flex items-center gap-2 pt-1">
        <Skeleton className="h-3.5 w-3.5 rounded-sm" />
        <Skeleton className="h-4 w-12 rounded-full" />
        <div className="ml-auto">
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/* ── List View Skeleton ────────────────────────── */

export function ListViewSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Filter bar skeleton */}
      <div className="flex items-center gap-2 border-b border-border px-6 py-2">
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* Table header */}
      <div className="hidden md:grid grid-cols-[80px_1fr_120px_100px_90px_90px_120px_80px_100px] gap-2 border-b border-border px-6 py-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>

      {/* Group header */}
      <div className="flex items-center gap-2 border-b border-border/50 bg-surface px-6 py-2">
        <Skeleton className="h-3.5 w-3.5" />
        <Skeleton className="h-2.5 w-2.5 rounded-full" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-6 rounded-full" />
      </div>

      {/* Rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <ListRowSkeleton key={i} />
      ))}
    </div>
  );
}

function ListRowSkeleton() {
  return (
    <div className="hidden md:grid grid-cols-[80px_1fr_120px_100px_90px_90px_120px_80px_100px] gap-2 border-b border-border/50 px-6 py-3 items-center">
      <Skeleton className="h-3 w-14" />
      <Skeleton className="h-3 w-3/4" />
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-2 w-2 rounded-full" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-3 w-3 rounded-sm" />
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-4 w-12 rounded" />
      <Skeleton className="h-4 w-16 rounded-full" />
      <Skeleton className="h-5 w-5 rounded-full" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

/* ── Issue Drawer Skeleton ─────────────────────── */

export function IssueDrawerSkeleton() {
  return (
    <div className="p-5 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4 rounded-sm" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-16" />
      </div>

      {/* Title */}
      <Skeleton className="h-6 w-3/4" />

      {/* Two-column layout */}
      <div className="flex gap-6">
        {/* Left: content */}
        <div className="flex-1 space-y-4">
          {/* Description label */}
          <Skeleton className="h-3 w-24" />
          {/* Description content */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          {/* Description block */}
          <Skeleton className="h-24 w-full rounded-lg" />

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Comments */}
          <Skeleton className="h-3 w-28" />
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>

          {/* Comment input */}
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>

        {/* Right: sidebar */}
        <div className="w-56 space-y-3">
          {/* Status */}
          <div className="space-y-1">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-6 w-full rounded-md" />
          </div>
          {/* Priority */}
          <div className="space-y-1">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-6 w-full rounded-md" />
          </div>
          {/* Type */}
          <div className="space-y-1">
            <Skeleton className="h-2.5 w-10" />
            <Skeleton className="h-6 w-24 rounded-md" />
          </div>
          {/* Source */}
          <div className="space-y-1">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-6 w-16 rounded-md" />
          </div>

          <div className="border-t border-border" />

          {/* Assignees */}
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <div className="flex gap-1">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          </div>

          {/* Due date */}
          <div className="space-y-1">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-6 w-full rounded-md" />
          </div>

          <div className="border-t border-border" />

          {/* Tags */}
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-10" />
            <div className="flex gap-1 flex-wrap">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-18 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
