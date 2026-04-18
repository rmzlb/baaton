/**
 * Custom auto-continue predicate for AI SDK's useChat.
 *
 * AI SDK ships `lastAssistantMessageIsCompleteWithToolCalls` which auto-resends
 * a request whenever the last assistant message has all tool calls filled. That
 * helper is designed for *client-interactive* tools — ones the user approves in
 * the UI (our `propose_*` family). After approval, addToolOutput sets the
 * output and a follow-up request lets the agent run the actual mutation
 * (`create_issue`, `update_issue`, etc).
 *
 * Problem: our backend agent loop ALSO runs read tools server-side and fills
 * their outputs in the same SSE stream. When the stream ends, every tool has
 * an output → the default helper triggers an auto-resend → backend re-runs
 * the agent loop → Gemini re-calls the same tools → user sees the answer
 * twice.
 *
 * This predicate only continues when a `propose_*` tool is present. Pure-read
 * runs end naturally, no duplicate turn.
 */
import type { UIMessage } from 'ai';

const CLIENT_INTERACTIVE_TOOLS = new Set([
  'propose_issue',
  'propose_update_issue',
  'propose_bulk_update',
  'propose_comment',
]);

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

function toolNameOf(part: { type: string; toolName?: string }): string {
  if (part.type === 'dynamic-tool') return part.toolName ?? '';
  return part.type.replace(/^tool-/, '');
}

export function shouldAutoContinueAfterApproval({
  messages,
}: {
  messages: UIMessage[];
}): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return false;

  const toolParts = last.parts.filter(isToolPart);
  if (toolParts.length === 0) return false;

  const allHaveOutput = toolParts.every(
    (p) => (p as { state?: string }).state === 'output-available',
  );
  if (!allHaveOutput) return false;

  return toolParts.some((p) => CLIENT_INTERACTIVE_TOOLS.has(toolNameOf(p)));
}
