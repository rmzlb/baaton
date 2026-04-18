import { useState } from 'react';
import { MessageSquare, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
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
        <Alert className="border-emerald-500/30 bg-emerald-500/5">
          <Check size={16} className="text-emerald-500" />
          <AlertTitle className="flex items-center gap-2 text-[12px]">
            <span className="text-emerald-400 font-medium">Approuvé</span>
            {input.display_id && <span className="font-mono text-[11px] text-[--color-muted]">{input.display_id}</span>}
          </AlertTitle>
        </Alert>
      );
    }
    return (
      <Alert className="border-[--color-border] bg-[--color-surface-hover]/30">
        <X size={16} className="text-[--color-muted]" />
        <AlertTitle className="text-[12px] text-[--color-muted]">Commentaire annulé</AlertTitle>
      </Alert>
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
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <MessageSquare size={16} className="text-amber-500" />
      <AlertTitle className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-wide">
          Proposition de commentaire
        </span>
        {input.display_id && (
          <Badge variant="secondary" className="ml-auto h-5 font-mono text-[10px]">
            {input.display_id}
          </Badge>
        )}
      </AlertTitle>

      <AlertDescription className="space-y-2">
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
      </AlertDescription>

      {!inBatch && (
        <div className="col-start-2 flex items-center justify-end gap-2 pt-2">
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
    </Alert>
  );
}
