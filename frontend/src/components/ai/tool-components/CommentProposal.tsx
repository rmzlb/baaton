import { useState } from 'react';
import { MessageSquare, Check, X, Loader2 } from 'lucide-react';

interface CommentProposalData {
  issue_id?: string;
  display_id?: string;
  title?: string;
  content?: string;
}

interface Props {
  data: CommentProposalData;
  onAction?: (prompt: string) => void;
}

export default function CommentProposal({ data, onAction }: Props) {
  const [content, setContent] = useState(data.content || '');
  const [submitted, setSubmitted] = useState<'approved' | 'cancelled' | null>(null);

  const handleApprove = () => {
    if (!onAction || submitted) return;
    setSubmitted('approved');
    onAction(
      `__INTERNAL__: User approved. Call add_comment now with EXACTLY these values:\n` +
      `- issue_id: ${data.issue_id}\n` +
      `- content: ${content}`
    );
  };

  const handleCancel = () => {
    if (!onAction || submitted) return;
    setSubmitted('cancelled');
    onAction("__INTERNAL__: User cancelled. Don't add the comment. Just acknowledge briefly.");
  };

  if (submitted === 'approved') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12px]">
        <Loader2 size={12} className="animate-spin text-emerald-500 shrink-0" />
        <span className="text-emerald-400 font-medium">Ajout du commentaire…</span>
        {data.display_id && <span className="font-mono text-[11px] text-[--color-muted]">{data.display_id}</span>}
      </div>
    );
  }
  if (submitted === 'cancelled') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[--color-border] bg-[--color-surface-hover]/30 px-3 py-2 text-[12px] text-[--color-muted]">
        <X size={12} className="shrink-0" />
        <span>Commentaire annule</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20 bg-amber-500/5">
        <MessageSquare size={13} className="text-amber-500 shrink-0" />
        <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-wide">
          Proposition de commentaire
        </span>
        {data.display_id && (
          <span className="ml-auto font-mono text-[10px] text-[--color-muted]">
            {data.display_id}
          </span>
        )}
      </div>

      <div className="p-3 space-y-2 bg-[--color-bg]">
        {data.title && (
          <p className="text-[11px] text-[--color-muted] italic line-clamp-1">
            sur : {data.title}
          </p>
        )}
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          disabled={!!submitted}
          rows={4}
          className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-2.5 py-1.5 text-[12px] text-[--color-primary] placeholder-[--color-muted] outline-none focus:border-amber-500 disabled:opacity-50 resize-none"
          placeholder="Votre commentaire en Markdown..."
        />
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
          disabled={!!submitted || !content.trim()}
          className="flex items-center gap-1.5 rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-black hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check size={12} />
          {submitted ? 'Envoye' : 'Commenter'}
        </button>
      </div>
    </div>
  );
}
