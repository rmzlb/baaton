import { Layers, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
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
        <Alert className="border-emerald-500/30 bg-emerald-500/5">
          <Check size={16} className="text-emerald-500" />
          <AlertTitle className="flex items-center gap-2 text-[12px]">
            <span className="text-emerald-400 font-medium">Approuvé</span>
            <span className="text-[--color-muted]">{updates.length} issues</span>
          </AlertTitle>
        </Alert>
      );
    }
    return (
      <Alert className="border-[--color-border] bg-[--color-surface-hover]/30">
        <X size={16} className="text-[--color-muted]" />
        <AlertTitle className="text-[12px] text-[--color-muted]">Bulk update annulé</AlertTitle>
      </Alert>
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
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <Layers size={16} className="text-amber-500" />
      <AlertTitle className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-wide">
          Bulk update
        </span>
        <span className="ml-auto text-[10px] text-[--color-muted] font-medium">
          {updates.length} issue{updates.length > 1 ? 's' : ''}
        </span>
      </AlertTitle>

      <AlertDescription>
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
      </AlertDescription>

      {!inBatch && (
        <div className="col-start-2 flex items-center justify-end gap-2 pt-2">
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
    </Alert>
  );
}
