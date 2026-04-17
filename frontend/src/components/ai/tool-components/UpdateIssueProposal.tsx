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
  /** Legacy format: pre-computed diff entries from the model */
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

function ApprovedBadge({ displayId }: { displayId?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12px]">
      <Check size={12} className="text-emerald-500 shrink-0" />
      <span className="text-emerald-400 font-medium">Approuve</span>
      {displayId && <span className="font-mono text-[11px] text-[--color-muted]">{displayId}</span>}
    </div>
  );
}

function CancelledBadge() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[--color-border] bg-[--color-surface-hover]/30 px-3 py-2 text-[12px] text-[--color-muted]">
      <X size={12} className="shrink-0" />
      <span>Modification annulee</span>
    </div>
  );
}

export default function UpdateIssueProposal({ part, addToolOutput }: Props) {
  const input = (part.input ?? {}) as UpdateInput;

  if (part.state === 'output-available') {
    const output = part.output as { approved: boolean; display_id?: string } | undefined;
    if (output?.approved) {
      return <ApprovedBadge displayId={input.display_id} />;
    }
    return <CancelledBadge />;
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
    <div className="rounded-xl border border-amber-500/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20 bg-amber-500/5">
        <Pencil size={13} className="text-amber-500 shrink-0" />
        <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-wide">
          Proposition de modification
        </span>
        {input.display_id && (
          <Badge variant="secondary" className="ml-auto h-5 font-mono text-[10px]">
            {input.display_id}
          </Badge>
        )}
      </div>

      <div className="p-3 space-y-2 bg-[--color-bg]">
        {input.title && (
          <p className="text-[13px] text-[--color-primary] font-medium line-clamp-2">
            {input.title}
          </p>
        )}

        {diffEntries.length === 0 ? (
          <p className="text-[11px] text-[--color-muted] italic py-2">
            Aucun changement propose.
          </p>
        ) : (
          <div className="space-y-1.5 pt-1">
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
          disabled={diffEntries.length === 0}
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
