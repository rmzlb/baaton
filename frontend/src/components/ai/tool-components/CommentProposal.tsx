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
  inBatch?: boolean;
}

export default function CommentProposal({ part, addToolOutput, inBatch }: Props) {
  const input = (part.input ?? {}) as CommentInput;
  const [content, setContent] = useState(input.content || '');

  if (part.state === 'output-available') {
    const output = part.output as { approved: boolean } | undefined;
    if (output?.approved) {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <Check size={14} className="text-emerald-500 shrink-0" />
          <span className="text-[12px] font-medium text-emerald-500">Commentaire ajouté</span>
          {input.display_id && <span className="text-[12px] text-[--color-muted] truncate">{input.display_id}</span>}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[--color-border] bg-[--color-surface] px-3 py-2">
        <X size={14} className="text-[--color-muted] shrink-0" />
        <span className="text-[12px] text-[--color-muted]">Commentaire annulé</span>
      </div>
    );
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
    <div className="rounded-2xl border border-[--color-border] bg-[--color-surface] overflow-hidden relative">
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-500" />

      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <MessageSquare size={14} className="text-amber-500 shrink-0" />
        <span className="text-[10px] font-semibold text-[--color-muted] uppercase tracking-wider">
          Ajouter un commentaire
        </span>
        {input.display_id && (
          <Badge variant="secondary" className="ml-auto h-5 font-mono text-[10px]">
            {input.display_id}
          </Badge>
        )}
      </div>

      <div className="px-4 pb-4 space-y-3">
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

      {!inBatch && (
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-[--color-border] bg-[--color-surface-hover]/30">
          <Button onClick={handleCancel} variant="secondary" size="sm">
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
      )}
    </div>
  );
}
