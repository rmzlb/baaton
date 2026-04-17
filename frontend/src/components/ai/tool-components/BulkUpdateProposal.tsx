import { useState } from 'react';
import { Layers, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BulkChange {
  issue_id: string;
  display_id?: string;
  title?: string;
  current?: { status?: string; priority?: string };
  changes?: Record<string, unknown>;
}

interface BulkUpdateProposalData {
  updates?: BulkChange[];
}

interface Props {
  data: BulkUpdateProposalData;
  onAction?: (prompt: string) => void;
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-amber-500',
  low: 'text-emerald-500',
};

export default function BulkUpdateProposal({ data, onAction }: Props) {
  const [submitted, setSubmitted] = useState<'approved' | 'cancelled' | null>(null);
  const updates = data.updates || [];

  const handleApprove = () => {
    if (!onAction || submitted) return;
    setSubmitted('approved');
    onAction(
      `__INTERNAL__: User approved bulk update. Call bulk_update_issues now with EXACTLY this array:\n` +
      `${JSON.stringify(updates.map(u => u.changes), null, 2)}`
    );
  };

  const handleCancel = () => {
    if (!onAction || submitted) return;
    setSubmitted('cancelled');
    onAction('__INTERNAL__: User cancelled bulk update. Just acknowledge briefly.');
  };

  if (submitted === 'approved') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12px]">
        <Loader2 size={12} className="animate-spin text-emerald-500 shrink-0" />
        <span className="text-emerald-400 font-medium">Bulk update en cours…</span>
        <span className="text-[--color-muted]">{updates.length} issues</span>
      </div>
    );
  }
  if (submitted === 'cancelled') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[--color-border] bg-[--color-surface-hover]/30 px-3 py-2 text-[12px] text-[--color-muted]">
        <X size={12} className="shrink-0" />
        <span>Bulk update annule</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20 bg-amber-500/5">
        <Layers size={13} className="text-amber-500 shrink-0" />
        <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-wide">
          Bulk update
        </span>
        <span className="ml-auto text-[10px] text-[--color-muted] font-medium">
          {updates.length} issue{updates.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="max-h-64 overflow-y-auto bg-[--color-bg]">
        {updates.length === 0 ? (
          <p className="p-3 text-[11px] text-[--color-muted] italic">
            Aucune modification proposee.
          </p>
        ) : (
          <ul className="divide-y divide-[--color-border]/40">
            {updates.map((u, i) => {
              const changes = u.changes as Record<string, unknown> | undefined;
              const newStatus = changes?.status as string | undefined;
              const newPriority = changes?.priority as string | undefined;

              return (
                <li key={i} className="px-3 py-2 text-[11px] hover:bg-[--color-surface-hover]/30">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-[--color-muted] shrink-0">
                      {u.display_id || '?'}
                    </span>
                    <span className="truncate text-[--color-primary]" title={u.title}>
                      {u.title || '(sans titre)'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 pl-0">
                    {newStatus && newStatus !== u.current?.status && (
                      <span className="text-[10px]">
                        <span className="text-[--color-muted] line-through">{u.current?.status || '—'}</span>
                        <span className="mx-1 text-[--color-muted]">→</span>
                        <span className="text-amber-500 font-medium">{newStatus}</span>
                      </span>
                    )}
                    {newPriority && newPriority !== u.current?.priority && (
                      <span className="text-[10px]">
                        <span className="text-[--color-muted] line-through">{u.current?.priority || '—'}</span>
                        <span className="mx-1 text-[--color-muted]">→</span>
                        <span className={cn('font-medium', PRIORITY_COLOR[newPriority] || 'text-amber-500')}>
                          {newPriority}
                        </span>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-[--color-border] bg-[--color-surface]/50">
        <button
          onClick={handleCancel}
          disabled={!!submitted}
          className="flex items-center gap-1.5 rounded-md border border-[--color-border] bg-[--color-bg] px-2.5 py-1 text-[11px] font-medium text-[--color-secondary] hover:text-[--color-primary] hover:border-[--color-muted] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X size={12} />
          Annuler
        </button>
        <button
          onClick={handleApprove}
          disabled={!!submitted || updates.length === 0}
          className="flex items-center gap-1.5 rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-black hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check size={12} />
          {submitted ? 'Envoye' : 'Appliquer'}
        </button>
      </div>
    </div>
  );
}
