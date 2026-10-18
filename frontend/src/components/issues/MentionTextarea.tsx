import { forwardRef, useCallback, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { activeMentionQuery, mentionToken } from '@/lib/mentions';
import type { OrgMember } from '@/hooks/useOrgMembers';

const MAX_SUGGESTIONS = 6;

export function memberLabel(m: OrgMember): string {
  return `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.email || m.user_id;
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  /** Members of the issue's org — the only people who can be mentioned. */
  members: OrgMember[];
  /** Keys the picker does not consume (⌘+Enter, Escape when closed…). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  ariaLabel?: string;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Textarea with an `@` member picker. Choosing a member inserts
 * `@[Name](user_id)`, which the server turns into a notification.
 */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(function MentionTextarea(
  { value, onChange, members, onKeyDown, placeholder, ariaLabel, rows = 2, autoFocus, className },
  forwardedRef,
) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current as HTMLTextAreaElement);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return members
      .filter((m) => !q || memberLabel(m).toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS);
  }, [mention, members]);

  const open = mention !== null;

  const syncMention = useCallback((text: string, caret: number) => {
    const next = activeMentionQuery(text, caret);
    setMention(next);
    setHighlight(0);
  }, []);

  const choose = useCallback(
    (m: OrgMember) => {
      const el = ref.current;
      if (!mention || !el) return;
      const caret = el.selectionStart ?? value.length;
      const token = `${mentionToken(memberLabel(m), m.user_id)} `;
      const next = value.slice(0, mention.start) + token + value.slice(caret);
      onChange(next);
      setMention(null);
      const pos = mention.start + token.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    },
    [mention, value, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'Escape') {
        // Close the picker only; the drawer listens for Escape on document.
        e.preventDefault();
        e.stopPropagation();
        setMention(null);
        return;
      }
      if (suggestions.length > 0) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.key === 'ArrowDown' ? 1 : -1;
          setHighlight((h) => (h + step + suggestions.length) % suggestions.length);
          return;
        }
        if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          choose(suggestions[highlight] ?? suggestions[0]);
          return;
        }
      }
    }
    onKeyDown?.(e);
  };

  const listId = `mentions-${useId().replace(/:/g, '')}`;

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={handleKeyDown}
        onClick={(e) => syncMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onBlur={() => setMention(null)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && suggestions[highlight] ? `${listId}-${suggestions[highlight].user_id}` : undefined}
        rows={rows}
        autoFocus={autoFocus}
        className={className}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={t('mentions.listLabel', { defaultValue: 'Mention a member' })}
          className="absolute bottom-full left-0 z-20 mb-1 w-64 max-w-full overflow-hidden rounded-xl border border-border bg-surface py-1"
        >
          {suggestions.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted">
              {members.length === 0
                ? t('mentions.loading', { defaultValue: 'Loading members…' })
                : t('mentions.noMatch', { defaultValue: 'No member matches' })}
            </p>
          ) : (
            suggestions.map((m, i) => (
              <button
                key={m.user_id}
                id={`${listId}-${m.user_id}`}
                type="button"
                role="option"
                aria-selected={i === highlight}
                // mousedown, not click: the textarea's blur would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
                  i === highlight ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                )}
              >
                {m.image_url ? (
                  <img src={m.image_url} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[8px] font-bold text-accent">
                    {memberLabel(m).slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-primary">{memberLabel(m)}</span>
                  {m.email && <span className="block truncate text-[10px] text-muted">{m.email}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
});
