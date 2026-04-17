import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolExecutingSpinner({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-xs text-[--color-muted]">
      <Loader2 size={12} className="animate-spin" />
      <span>Running {name}…</span>
    </div>
  );
}

function ComponentSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-3 w-3/4 rounded bg-[--color-surface-hover]" />
      <div className="h-3 w-1/2 rounded bg-[--color-surface-hover]" />
      <div className="h-3 w-2/3 rounded bg-[--color-surface-hover]" />
    </div>
  );
}

// ─── Rich output node ─────────────────────────────────────────────────────────

function RichOutput({ event }: { event: ToolCallEvent }) {
  if (!event.result) return null;

  const Component = event.result.component
    ? TOOL_COMPONENTS[event.result.component]
    : null;

  if (!Component) {
    return (
      <ToolResultFallback summary={event.result.summary} />
    );
  }

  return (
    <Suspense fallback={<ComponentSkeleton />}>
      <Component data={event.result.data} />
    </Suspense>
  );
}

// ─── Main renderer ────────────────────────────────────────────────────────────

export interface ToolResultRendererProps {
  event: ToolCallEvent;
}

/**
 * Renders a single tool call event using AI Elements' Tool component for the
 * collapsible chrome (header + status badge), with custom data-rich components
 * embedded inside ToolOutput.
 *
 * Map of states:
 *   executing → input-available  (spinning "Running" badge)
 *   done      → output-available (green "Completed" badge)
 *   error     → output-error     (red "Error" badge)
 */
export function ToolResultRenderer({ event }: ToolResultRendererProps) {
  const aiState = STATE_MAP[event.status];
  const isOpen = event.status !== 'executing';

  return (
    <Tool defaultOpen={isOpen}>
      <ToolHeader
        type="dynamic-tool"
        state={aiState}
        toolName={event.name}
      />

      <ToolContent>
        {/* Always show inputs */}
        <ToolInput input={event.args} />

        {/* While executing: show spinner */}
        {event.status === 'executing' && (
          <ToolExecutingSpinner name={event.name} />
        )}

        {/* On completion: show rich output via ToolOutput */}
        {event.status === 'done' && event.result && (
          <ToolOutput
            // ToolOutput checks isValidElement; ReactNode is valid as output: unknown
            output={<RichOutput event={event} />}
            errorText={undefined}
          />
        )}

        {/* On error: show error text */}
        {event.status === 'error' && (
          <ToolOutput
            output={undefined}
            errorText={event.result?.summary ?? 'Tool call failed'}
          />
        )}
      </ToolContent>
    </Tool>
  );
}
