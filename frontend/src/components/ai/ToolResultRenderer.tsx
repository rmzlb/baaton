import { Suspense } from 'react';
import { Loader2, Wrench } from 'lucide-react';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import type { DynamicToolUIPart } from 'ai';
import { TOOL_COMPONENTS } from './tool-components';
import ToolResultFallback from './tool-components/ToolResultFallback';
import type { ToolCallEvent } from '@/hooks/useAgentChat';

// ─── State mapping ────────────────────────────────────────────────────────────

type AIElementsState = DynamicToolUIPart['state'];

const STATE_MAP: Record<ToolCallEvent['status'], AIElementsState> = {
  executing: 'input-available',
  done: 'output-available',
  error: 'output-error',
};

// ─── Compact executing indicator ──────────────────────────────────────────────

function ExecutingIndicator({ name }: { name: string }) {
  const displayName = name
    .replace(/^propose_/, '')
    .replace(/_/g, ' ');
  return (
    <div className="flex items-center gap-2 rounded-lg bg-[--color-surface-hover]/50 px-3 py-1.5 text-[11px] text-[--color-muted]">
      <Loader2 size={12} className="animate-spin text-amber-500" />
      <span className="capitalize">{displayName}...</span>
    </div>
  );
}

function ComponentSkeleton() {
  return (
    <div className="space-y-2 animate-pulse rounded-lg p-3">
      <div className="h-3 w-3/4 rounded bg-[--color-surface-hover]" />
      <div className="h-3 w-1/2 rounded bg-[--color-surface-hover]" />
      <div className="h-3 w-2/3 rounded bg-[--color-surface-hover]" />
    </div>
  );
}

// ─── Minimal badge for background tools (metrics, search) ─────────────────────

function CompletedBadge({ name }: { name: string }) {
  const displayName = name.replace(/_/g, ' ');
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-[--color-muted]">
      <Wrench size={10} />
      <span className="capitalize">{displayName}</span>
    </div>
  );
}

// ─── Main renderer ────────────────────────────────────────────────────────────

export interface ToolResultRendererProps {
  event: ToolCallEvent;
  onAction?: (prompt: string) => void;
}

/**
 * Renders a tool call event.
 *
 * Strategy:
 * - If tool has a registered custom component (IssueProposal, MetricsCard, etc.)
 *   → render the component DIRECTLY (compact, no Tool wrapper)
 * - If executing → small spinner
 * - If error → error card
 * - Otherwise (raw data from unknown tool) → collapsible Tool with JSON params
 *
 * This matches the AI SDK Elements pattern where rich custom components replace
 * the generic Tool chrome entirely.
 */
export function ToolResultRenderer({ event, onAction }: ToolResultRendererProps) {
  // Still executing → tiny inline indicator
  if (event.status === 'executing') {
    return <ExecutingIndicator name={event.name} />;
  }

  // Error → always show the Tool wrapper with error state (useful for debugging)
  if (event.status === 'error') {
    const aiState = STATE_MAP[event.status];
    return (
      <Tool defaultOpen>
        <ToolHeader type="dynamic-tool" state={aiState} toolName={event.name} />
        <ToolContent>
          <ToolInput input={event.args} />
          <ToolOutput
            output={undefined}
            errorText={event.result?.summary ?? 'Tool call failed'}
          />
        </ToolContent>
      </Tool>
    );
  }

  // Done
  if (!event.result) return null;

  const Component = event.result.component
    ? TOOL_COMPONENTS[event.result.component]
    : null;

  // No custom component → fallback with collapsible Tool wrapper
  if (!Component) {
    return (
      <Tool defaultOpen={false}>
        <ToolHeader
          type="dynamic-tool"
          state={STATE_MAP[event.status]}
          toolName={event.name}
        />
        <ToolContent>
          <ToolInput input={event.args} />
          <ToolOutput
            output={<ToolResultFallback summary={event.result.summary} />}
            errorText={undefined}
          />
        </ToolContent>
      </Tool>
    );
  }

  // Rich component → render DIRECTLY, no Tool chrome.
  // This is the AI SDK Elements pattern: custom UI replaces the generic tool UI.
  return (
    <div className="space-y-1.5">
      <CompletedBadge name={event.name} />
      <Suspense fallback={<ComponentSkeleton />}>
        <Component data={event.result.data} onAction={onAction} />
      </Suspense>
    </div>
  );
}
