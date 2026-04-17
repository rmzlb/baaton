import { useState } from 'react';
import { MessageSquare, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import type { DynamicToolUIPart } from 'ai';

interface CommentInput {
  issue_id?: string;
  display_id?: string;
  title?: string;
  content?: string;
}

interface Props {
  part: DynamicToolUIPart;
  addToolOutput: (opts: { tool: string; toolCallId: string; output: unknown }) => void;
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
      <span>Commentaire annule</span>
    </div>
  );
}

export default function CommentProposal({ part, addToolOutput }: Props) {
  const input = (part.input ?? {}) as CommentInput;
  const [content, setContent] = useState(input.content || '');

  if (part.state === 'output-available') {
    const output = part.output as { approved: boolean } | undefined;
    if (output?.approved) {
      return <ApprovedBadge displayId={input.display_id} />;
    }
    return <CancelledBadge />;
  }

  if (part.state !== 'input-available') return null;

  const handleApprove = () => {
    addToolOutput({
      tool: 'propose_comment',
      toolCallId: part.toolCallId,
      output: { approved: true, finalContent: content },
    });
  };

  const handleCancel = () => {
    addToolOutput({
      tool: 'propose_comment',
      toolCallId: part.toolCallId,
      output: { approved: false },
    });
  };

  return (
    <div className="rounded-xl border border-amber-500/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20 bg-amber-500/5">
        <MessageSquare size={13} className="text-amber-500 shrink-0" />
        <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-wide">
          Proposition de commentaire
        </span>
        {input.display_id && (
          <Badge variant="secondary" className="ml-auto h-5 font-mono text-[10px]">
            {input.display_id}
          </Badge>
        )}
      </div>

      <div className="p-3 space-y-2 bg-[--color-bg]">
        {input.title && (
          <p className="text-[11px] text-[--color-muted] italic line-clamp-1">
            sur : {input.title}
          </p>
        )}
        <Textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={4}
          placeholder="Votre commentaire en Markdown..."
          className="text-[12px] resize-none"
        />
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
          disabled={!content.trim()}
          size="sm"
          className="bg-amber-500 text-black hover:bg-amber-400"
        >
          <Check size={12} />
          Commenter
        </Button>
      </div>
    </div>
  );
}
