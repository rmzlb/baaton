import { Layers, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { DynamicToolUIPart } from 'ai';

interface BulkChange {
  issue_id: string;
  display_id?: string;
  title?: string;
  current?: { status?: string; priority?: string };
  changes?: Record<string, unknown>;
}

interface BulkInput {
  updates: BulkChange[];
}

interface Props {
  part: DynamicToolUIPart;
  addToolOutput: (opts: { tool: string; toolCallId: string; output: unknown }) => void;
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-amber-500',
  low: 'text-emerald-500',
};

function ApprovedBadge({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12px]">
      <Check size={12} className="text-emerald-500 shrink-0" />
      <span className="text-emerald-400 font-medium">Approuve</span>
      <span className="text-[--color-muted]">{count} issues</span>
    </div>
  );
}

function CancelledBadge() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[--color-border] bg-[--color-surface-hover]/30 px-3 py-2 text-[12px] text-[--color-muted]">
      <X size={12} className="shrink-0" />
      <span>Bulk update annule</span>
    </div>
  );
}

export default function BulkUpdateProposal({ part, addToolOutput }: Props) {
  const input = (part.input ?? {}) as BulkInput;
  const updates = input.updates ?? [];

  if (part.state === 'output-available') {
    const output = part.output as { approved: boolean } | undefined;
    if (output?.approved) {
      return <ApprovedBadge count={updates.length} />;
    }
    return <CancelledBadge />;
  }

  if (part.state !== 'input-available') return null;

  const handleApprove = () => {
    addToolOutput({
      tool: 'propose_bulk_update',
      toolCallId: part.toolCallId,
      output: { approved: true, updates },
    });
  };

  const handleCancel = () => {
    addToolOutput({
      tool: 'propose_bulk_update',
      toolCallId: part.toolCallId,
      output: { approved: false },
    });
  };

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
        <Button
          onClick={handleCancel}
          variant="secondary"
          size="sm"
        >
          <X size={12} />
          Annuler
        </Button>
        <Button
          onClick={handleApprove}
          disabled={updates.length === 0}
          size="sm"
          className="bg-amber-500 text-black hover:bg-amber-400"
        >
          <Check size={12} />
          Appliquer
        </Button>
      </div>
    </div>
  );
}
