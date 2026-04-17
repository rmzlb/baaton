import { useState } from 'react';
import { Pencil, Check, X, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface DiffEntry {
  field: string;
  from: string | string[];
  to: string | string[];
}

interface UpdateProposalData {
  issue_id?: string;
  display_id?: string;
  title?: string;
  diff?: DiffEntry[];
}

interface Props {
  data: UpdateProposalData;
  onAction?: (prompt: string) => void;
}

function DiffValue({ value, muted }: { value: string | string[]; muted?: boolean }) {
  const text = Array.isArray(value) ? (value.length ? value.join(', ') : '—') : (value || '—');
  return (
    <span className={cn(
      'font-mono text-[11px] rounded px-1.5 py-0.5 truncate max-w-[140px] inline-block',
      muted ? 'text-[--color-muted] bg-[--color-surface-hover] line-through' : 'text-amber-500 bg-amber-500/10',
    )} title={text}>
      {text}
    </span>
  );
}

export default function UpdateIssueProposal({ data, onAction }: Props) {
  const safe = data ?? {};
  const [submitted, setSubmitted] = useState<'approved' | 'cancelled' | null>(null);
  const diff = safe.diff || [];

  const handleApprove = () => {
    if (!onAction || submitted) return;
    setSubmitted('approved');
    const changes = diff.map(d => {
      const to = Array.isArray(d.to) ? `[${d.to.join(', ')}]` : d.to;
      return `- ${d.field}: ${to}`;
    }).join('\n');
    onAction(
      `__INTERNAL__: User approved. Call update_issue now with EXACTLY these values:\n` +
      `- issue_id: ${safe.issue_id}\n${changes}`
    );
  };

  const handleCancel = () => {
    if (!onAction || submitted) return;
    setSubmitted('cancelled');
    onAction("__INTERNAL__: User cancelled. Don't update the issue. Just acknowledge briefly.");
  };

  if (submitted === 'approved') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12px]">
        <Loader2 size={12} className="animate-spin text-emerald-500 shrink-0" />
        <span className="text-emerald-400 font-medium">Mise a jour en cours…</span>
        {safe.display_id && <span className="font-mono text-[11px] text-[--color-muted]">{safe.display_id}</span>}
      </div>
    );
  }
  if (submitted === 'cancelled') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[--color-border] bg-[--color-surface-hover]/30 px-3 py-2 text-[12px] text-[--color-muted]">
        <X size={12} className="shrink-0" />
        <span>Modification annulee</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20 bg-amber-500/5">
        <Pencil size={13} className="text-amber-500 shrink-0" />
        <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-wide">
          Proposition de modification
        </span>
        {safe.display_id && (
          <Badge variant="secondary" className="ml-auto h-5 font-mono text-[10px]">
            {safe.display_id}
          </Badge>
        )}
      </div>

      <div className="p-3 space-y-2 bg-[--color-bg]">
        {safe.title && (
          <p className="text-[13px] text-[--color-primary] font-medium line-clamp-2">
            {safe.title}
          </p>
        )}

        {diff.length === 0 ? (
          <p className="text-[11px] text-[--color-muted] italic py-2">
            Aucun changement propose.
          </p>
        ) : (
          <div className="space-y-1.5 pt-1">
            {diff.map((d, i) => (
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
          disabled={!!submitted}
          variant="secondary"
          size="sm"
        >
          <X size={12} />
          Annuler
        </Button>
        <Button
          onClick={handleApprove}
          disabled={!!submitted || diff.length === 0}
          size="sm"
          className="bg-amber-500 text-black hover:bg-amber-400"
        >
          <Check size={12} />
          {submitted ? 'Envoye' : 'Appliquer'}
        </Button>
      </div>
    </div>
  );
}
