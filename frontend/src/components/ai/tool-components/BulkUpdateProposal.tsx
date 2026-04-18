import { Layers, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  inBatch?: boolean;
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-amber-500',
  low: 'text-emerald-500',
};

export default function BulkUpdateProposal({ part, addToolOutput, inBatch }: Props) {
  const input = (part.input ?? {}) as BulkInput;
  const updates = input.updates ?? [];

  if (part.state === 'output-available') {
    const output = part.output as { approved: boolean } | undefined;
    if (output?.approved) {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <Check size={14} className="text-emerald-500 shrink-0" />
          <span className="text-[12px] font-medium text-emerald-500">{updates.length} issues mises à jour</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[--color-border] bg-[--color-surface] px-3 py-2">
        <X size={14} className="text-[--color-muted] shrink-0" />
        <span className="text-[12px] text-[--color-muted]">Bulk update annulé</span>
      </div>
    );
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
    <div className="rounded-2xl border border-[--color-border] bg-[--color-surface] overflow-hidden relative">
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-500" />

      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <Layers size={14} className="text-amber-500 shrink-0" />
        <span className="text-[10px] font-semibold text-[--color-muted] uppercase tracking-wider">
          Bulk update
        </span>
        <Badge variant="secondary" className="ml-auto h-5 font-mono text-[10px]">
          {updates.length} issue{updates.length > 1 ? 's' : ''}
        </Badge>
      </div>

      <div className="px-4 pb-4 space-y-3">
        {updates.length === 0 ? (
          <p className="text-[11px] text-[--color-muted] italic py-2">
            Aucune modification proposée.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto -mx-4 px-4">
            <ul className="divide-y divide-[--color-border]/40">
              {updates.map((u, i) => {
                const changes = u.changes as Record<string, unknown> | undefined;
                const newStatus = changes?.status as string | undefined;
                const newPriority = changes?.priority as string | undefined;

                return (
                  <li key={i} className="py-2 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-[--color-muted] shrink-0">
                        {u.display_id || '?'}
                      </span>
                      <span className="truncate text-[--color-primary]" title={u.title}>
                        {u.title || '(sans titre)'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
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
          </div>
        )}
      </div>

      {!inBatch && (
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-[--color-border] bg-[--color-surface-hover]/30">
          <Button onClick={handleCancel} variant="secondary" size="sm">
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
      )}
    </div>
  );
}
