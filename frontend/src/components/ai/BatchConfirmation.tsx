import { useState } from 'react';
import { Sparkles, Check, X } from 'lucide-react';
import type { ToolUIPart, DynamicToolUIPart } from 'ai';
import { Button } from '@/components/ui/button';
import { ToolPartRenderer } from './ToolPartRenderer';

type AnyToolPart = ToolUIPart | DynamicToolUIPart;

function getToolName(part: AnyToolPart): string {
  if (part.type === 'dynamic-tool') return (part as DynamicToolUIPart).toolName;
  return part.type.replace(/^tool-/, '');
}

function extractFinalValues(toolName: string, input: Record<string, unknown>): unknown {
  switch (toolName) {
    case 'propose_issue':
      return {
        approved: true,
        finalValues: {
          project_id: input.project_id ?? '',
          title: input.title ?? '',
          description: input.description ?? '',
          type: input.type ?? 'feature',
          priority: input.priority ?? 'medium',
          tags: input.tags ?? [],
          category: input.category ?? [],
          status: 'backlog',
        },
      };
    case 'propose_update_issue': {
      const changes = (input.proposed_changes as Record<string, unknown>) ?? {};
      return {
        approved: true,
        finalValues: { issue_id: input.issue_id, ...changes },
      };
    }
    case 'propose_bulk_update':
      return { approved: true, updates: input.updates ?? [] };
    case 'propose_comment':
      return { approved: true, finalContent: input.content ?? '' };
    default:
      return { approved: true };
  }
}

interface BatchConfirmationProps {
  parts: AnyToolPart[];
  addToolOutput: (opts: { tool: string; toolCallId: string; output: unknown }) => void;
}

export function BatchConfirmation({ parts, addToolOutput }: BatchConfirmationProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>(
    () => Object.fromEntries(parts.map(p => [p.toolCallId, true])),
  );
  const [submitted, setSubmitted] = useState(false);

  const selectedCount = Object.values(selected).filter(Boolean).length;

  const handleApproveAll = () => {
    if (submitted) return;
    setSubmitted(true);
    for (const part of parts) {
      const toolName = getToolName(part);
      const input = (part.input ?? {}) as Record<string, unknown>;
      const isSelected = selected[part.toolCallId];
      addToolOutput({
        tool: toolName,
        toolCallId: part.toolCallId,
        output: isSelected ? extractFinalValues(toolName, input) : { approved: false },
      });
    }
  };

  const handleCancelAll = () => {
    if (submitted) return;
    setSubmitted(true);
    for (const part of parts) {
      const toolName = getToolName(part);
      addToolOutput({
        tool: toolName,
        toolCallId: part.toolCallId,
        output: { approved: false },
      });
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <div className="px-3 py-2 border-b border-amber-500/20 bg-amber-500/10 flex items-center gap-2">
        <Sparkles size={14} className="text-amber-500" />
        <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-wide">
          {parts.length} propositions en attente
        </span>
      </div>

      <div className="divide-y divide-[--color-border]">
        {parts.map(part => (
          <div key={part.toolCallId} className="flex gap-2 p-2">
            <input
              type="checkbox"
              checked={selected[part.toolCallId] ?? true}
              onChange={e => setSelected(s => ({ ...s, [part.toolCallId]: e.target.checked }))}
              disabled={submitted}
              className="mt-2 accent-amber-500 cursor-pointer"
            />
            <div className="flex-1 min-w-0">
              <ToolPartRenderer part={part} addToolOutput={addToolOutput} inBatch />
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 flex items-center justify-between gap-2 px-3 py-2 border-t border-[--color-border] bg-[--color-surface]/80 backdrop-blur-sm">
        <span className="text-[11px] text-[--color-muted]">
          {selectedCount} / {parts.length} selectionnes
        </span>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleCancelAll}
            disabled={submitted}
            variant="secondary"
            size="sm"
          >
            <X size={12} />
            Tout annuler
          </Button>
          <Button
            onClick={handleApproveAll}
            disabled={submitted || selectedCount === 0}
            size="sm"
            className="bg-amber-500 text-black hover:bg-amber-400"
          >
            <Check size={12} />
            {submitted ? 'Envoye' : `Approuver (${selectedCount})`}
          </Button>
        </div>
      </div>
    </div>
  );
}
