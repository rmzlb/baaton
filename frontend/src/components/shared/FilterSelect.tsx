import * as Popover from '@radix-ui/react-popover';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Fragment } from 'react';

export interface FilterSelectOption {
  value: string;
  label: string;
  count?: number;
  prefix?: string;
}

export interface FilterSelectGroup {
  key: string;
  label: string;
  options: FilterSelectOption[];
}

interface FilterSelectProps {
  label: string;
  groups?: FilterSelectGroup[];
  options?: FilterSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  multi?: boolean;
  allLabel?: string;
  allCount?: number;
  widthClassName?: string;
  triggerClassName?: string;
  contentClassName?: string;
  emptyLabel?: string;
  groupSelectLabel?: string;
  groupClearLabel?: string;
}

export function FilterSelect({
  label,
  groups,
  options,
  selectedValues,
  onChange,
  multi = true,
  allLabel,
  allCount,
  widthClassName = 'min-w-[320px]',
  triggerClassName,
  contentClassName,
  emptyLabel = 'No options',
  groupSelectLabel = 'Select group',
  groupClearLabel = 'Clear group',
}: FilterSelectProps) {
  const grouped = groups ?? (options ? [{ key: 'default', label: '', options }] : []);

  const toggle = (value: string) => {
    if (!multi) {
      onChange(value ? [value] : []);
      return;
    }
    if (selectedValues.includes(value)) onChange(selectedValues.filter((v) => v !== value));
    else onChange([...selectedValues, value]);
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors',
            selectedValues.length > 0
              ? 'border-accent/30 bg-accent/8 text-primary'
              : 'border-border bg-surface text-secondary hover:bg-surface-hover hover:text-primary',
            triggerClassName,
          )}
        >
          <span className="truncate">{label}</span>
          {typeof allCount === 'number' && (
            <span className="text-[10px] text-muted">{selectedValues.length === 0 ? allCount : selectedValues.length}</span>
          )}
          <ChevronDown size={12} className="text-muted" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="start"
          className={cn(
            'z-50 rounded-2xl border border-border bg-surface shadow-2xl outline-none',
            widthClassName,
            contentClassName,
          )}
        >
          <ScrollArea.Root className="max-h-[420px] overflow-hidden rounded-2xl">
            <ScrollArea.Viewport className="max-h-[420px] p-1">
              {allLabel && (
                <button
                  onClick={() => onChange([])}
                  className={cn(
                    'w-full rounded-xl px-3 py-2 text-left text-sm transition-colors',
                    selectedValues.length === 0 ? 'bg-accent/10 text-primary' : 'text-secondary hover:bg-surface-hover hover:text-primary',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>{allLabel}</span>
                    {typeof allCount === 'number' && <span className="text-[11px] text-muted">{allCount}</span>}
                  </div>
                </button>
              )}

              {grouped.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted">{emptyLabel}</div>
              )}

              {grouped.map((group, index) => {
                const groupValues = group.options.map((option) => option.value);
                const allSelected = groupValues.length > 0 && groupValues.every((value) => selectedValues.includes(value));

                return (
                  <Fragment key={group.key}>
                    {index > 0 && <div className="mx-2 my-2 border-t border-border/60" />}
                    {group.label && (
                      <div className="mb-1 flex items-center justify-between gap-2 px-2 pt-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{group.label}</span>
                        {multi && group.options.length > 1 && (
                          <button
                            onClick={() => {
                              if (allSelected) onChange(selectedValues.filter((value) => !groupValues.includes(value)));
                              else onChange(Array.from(new Set([...selectedValues, ...groupValues])));
                            }}
                            className="text-[10px] text-accent hover:text-accent-hover"
                          >
                            {allSelected ? groupClearLabel : groupSelectLabel}
                          </button>
                        )}
                      </div>
                    )}

                    {group.options.map((option) => {
                      const selected = selectedValues.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          onClick={() => toggle(option.value)}
                          className={cn(
                            'w-full rounded-xl px-3 py-2 text-left text-sm transition-colors',
                            selected ? 'bg-accent/10 text-primary' : 'text-secondary hover:bg-surface-hover hover:text-primary',
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2">
                              <span className={cn('flex h-4 w-4 items-center justify-center rounded border', selected ? 'border-accent bg-accent text-black' : 'border-border bg-transparent')}>
                                {selected && <Check size={11} />}
                              </span>
                              {option.prefix && <span className="font-mono text-[11px] text-muted">{option.prefix}</span>}
                              <span className="truncate">{option.label}</span>
                            </div>
                            {typeof option.count === 'number' && <span className="shrink-0 text-[11px] text-muted">{option.count}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </Fragment>
                );
              })}
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none p-0.5">
              <ScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
