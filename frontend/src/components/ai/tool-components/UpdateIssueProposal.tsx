import { Pencil, Check, X, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { DynamicToolUIPart } from 'ai';

interface UpdateInput {
  issue_id: string;
  display_id?: string;
  title?: string;
  current_values?: Record<string, unknown>;
  proposed_changes: Record<string, unknown>;
  diff?: DiffEntry[];
}

interface DiffEntry {
  field: string;
  from: string | string[];
  to: string | string[];
}

interface Props {
  part: DynamicToolUIPart;
  addToolOutput: (opts: { tool: string; toolCallId: string; output: unknown }) => void;
  inBatch?: boolean;
}

function DiffValue({ value, muted }: { value: string | string[] | unknown; muted?: boolean }) {
  const raw = Array.isArray(value) ? (value.length ? value.join(', ') : '—') : (String(value ?? '') || '—');
  return (
    <span className={cn(
      'font-mono text-[11px] rounded px-1.5 py-0.5 truncate max-w-[140px] inline-block',
      muted ? 'text-[--color-muted] bg-[--color-surface-hover] line-through' : 'text-amber-500 bg-amber-500/10',
    )} title={raw}>
      {raw}
    </span>
  );
}

export default function UpdateIssueProposal({ part, addToolOutput, inBatch }: Props) {
  const input = (part.input ?? {}) as UpdateInput;

  if (part.state === 'output-available') {
    const output = part.output as { approved: boolean; display_id?: string } | undefined;
    if (output?.approved) {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <Check size={14} className="text-emerald-500 shrink-0" />
          <span className="text-[12px] font-medium text-emerald-500">Mis à jour</span>
          {input.display_id && <span className="text-[12px] text-[--color-muted] truncate">{input.display_id}</span>}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[--color-border] bg-[--color-surface] px-3 py-2">
        <X size={14} className="text-[--color-muted] shrink-0" />
        <span className="text-[12px] text-[--color-muted]">Modification annulée</span>
      </div>
    );
  }

  if (part.state !== 'input-available') return null;

  const diffEntries: DiffEntry[] = input.diff ??
    (input.proposed_changes
      ? Object.entries(input.proposed_changes).map(([field, to]) => ({
          field,
          from: (input.current_values?.[field] ?? '—') as string | string[],
          to: to as string | string[],
        }))
      : []);

  const handleApprove = () => {
    const changes = input.proposed_changes ??
      Object.fromEntries(diffEntries.map(d => [d.field, d.to]));
    addToolOutput({
      tool: 'propose_update_issue',
      toolCallId: part.toolCallId,
      output: {
        approved: true,
        finalValues: { issue_id: input.issue_id, ...changes },
      },
    });
  };

  const handleCancel = () => {
    addToolOutput({
      tool: 'propose_update_issue',
      toolCallId: part.toolCallId,
      output: { approved: false },
    });
  };

  return (
    <div className="rounded-2xl border border-[--color-border] bg-[--color-surface] overflow-hidden relative">
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-500" />

      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <Pencil size={14} className="text-amber-500 shrink-0" />
        <span className="text-[10px] font-semibold text-[--color-muted] uppercase tracking-wider">
          Modifier une issue
        </span>
        {input.display_id && (
          <Badge variant="secondary" className="ml-auto h-5 font-mono text-[10px]">
            {input.display_id}
          </Badge>
        )}
      </div>

      <div className="px-4 pb-4 space-y-3">
        {input.title && (
          <p className="text-[13px] text-[--color-primary] font-medium line-clamp-2">
            {input.title}
          </p>
        )}

        {diffEntries.length === 0 ? (
          <p className="text-[11px] text-[--color-muted] italic py-2">
            Aucun changement proposé.
          </p>
        ) : (
          <div className="space-y-1.5">
            {diffEntries.map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="text-[--color-muted] uppercase tracking-wide text-[9px] w-16 shrink-0 font-medium">
                  {d.field}
                </span>
                <DiffValue value={d.from} muted />
                <ArrowRight size={10} className="text-[--color-muted] shrink-0" />
                <DiffValue value={d.to} />
              </div>
            ))}
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
            disabled={diffEntries.length === 0}
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
