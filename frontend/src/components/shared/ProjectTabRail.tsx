import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ProjectTabOption {
  id: string;
  name: string;
  prefix: string;
  count: number;
}

interface ProjectTabRailProps {
  projects: ProjectTabOption[];
  /** Empty array means "All". */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  allLabel: string;
  allCount: number;
  emptyLabel: string;
}

/**
 * Flat, scrollable project switcher — one click per project, no dropdown.
 *
 * Projects are ordered by open-issue volume, not alphabetically: on a real
 * account the busiest project carries ~55% of all issues while a third of
 * projects are dormant, so alphabetical order buries the only tabs that matter.
 *
 * Prefix + name are both shown because neither is unique on its own (two
 * projects can share the `CON` prefix across orgs, and two others share the
 * name "Sextan Assist"). Orgs are deliberately not surfaced here — this is a
 * filter, not a hierarchy browser.
 */
export function ProjectTabRail({
  projects,
  selectedIds,
  onChange,
  allLabel,
  allCount,
  emptyLabel,
}: ProjectTabRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setOverflow({
      left: el.scrollLeft > 2,
      right: max > 2 && el.scrollLeft < max - 2,
    });
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = railRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, projects.length]);

  // A selected tab parked outside the viewport reads as "no selection at all",
  // which is the failure mode that makes horizontal rails feel broken.
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [selectedIds]);

  const nudge = (dir: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  // Plain click replaces the selection (the fast path). Cmd/Ctrl-click keeps the
  // multi-project comparison the old dropdown allowed.
  const pick = (id: string, additive: boolean) => {
    if (!additive) {
      onChange(selectedIds.length === 1 && selectedIds[0] === id ? [] : [id]);
      return;
    }
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((v) => v !== id) : [...selectedIds, id],
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const el = railRef.current;
    if (!el) return;
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]'));
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i === -1) return;
    e.preventDefault();
    tabs[e.key === 'ArrowRight' ? Math.min(i + 1, tabs.length - 1) : Math.max(i - 1, 0)]?.focus();
  };

  if (projects.length === 0) {
    return <span className="text-xs text-muted px-1">{emptyLabel}</span>;
  }

  const allActive = selectedIds.length === 0;

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      {overflow.left && (
        <button
          onClick={() => nudge(-1)}
          aria-label="Scroll projects left"
          className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border bg-surface text-secondary hover:text-primary"
        >
          <ChevronLeft size={13} />
        </button>
      )}

      <div className="relative flex min-w-0 flex-1 items-center">
        {overflow.left && (
          <span className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-bg to-transparent" />
        )}

        <div
          ref={railRef}
          role="tablist"
          aria-label="Project filter"
          onScroll={measure}
          onKeyDown={onKeyDown}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <Tab
            active={allActive}
            label={allLabel}
            count={allCount}
            onClick={() => onChange([])}
          />

          <span className="mx-1 h-4 w-px shrink-0 bg-border" />

          {projects.map((p) => (
            <Tab
              key={p.id}
              active={selectedIds.includes(p.id)}
              label={p.name}
              prefix={p.prefix}
              count={p.count}
              onClick={(e) => pick(p.id, e.metaKey || e.ctrlKey)}
            />
          ))}
        </div>

        {overflow.right && (
          <span className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-bg to-transparent" />
        )}
      </div>

      {overflow.right && (
        <button
          onClick={() => nudge(1)}
          aria-label="Scroll projects right"
          className="ml-1 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border bg-surface text-secondary hover:text-primary"
        >
          <ChevronRight size={13} />
        </button>
      )}
    </div>
  );
}

function Tab({
  active,
  label,
  prefix,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  prefix?: string;
  count: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      data-active={active}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      title={prefix ? `${prefix} · ${label}` : label}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs transition-colors',
        active
          ? 'border-accent/40 bg-accent/12 font-medium text-primary'
          : 'border-transparent text-secondary hover:bg-surface-hover hover:text-primary',
      )}
    >
      {prefix && (
        <span
          className={cn(
            'font-mono text-[10px] tracking-wide',
            active ? 'text-accent' : 'text-muted',
          )}
        >
          {prefix}
        </span>
      )}
      <span className="max-w-[13ch] truncate">{label}</span>
      <span
        className={cn(
          'rounded border px-1 text-[10px] tabular-nums',
          active
            ? 'border-accent/30 bg-accent/15 text-primary'
            : 'border-border bg-bg text-muted',
        )}
      >
        {count}
      </span>
    </button>
  );
}
