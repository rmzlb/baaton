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
 * Problem 1: our backend agent loop ALSO runs read tools server-side and fills
 * their outputs in the same SSE stream. When the stream ends, every tool has
 * an output → the default helper triggers an auto-resend → backend re-runs
 * the agent loop → Gemini re-calls the same tools → user sees the answer
 * twice.
 *
 * Problem 2 (loop bug): after auto-continue fires, the AI SDK appends the
 * continuation's tool results (e.g. create_issue) to the SAME assistant
 * message. The old propose_* part (output-available) is still present → this
 * predicate would fire again → infinite loop. Fix: if write-mutation tools
 * already have output, the continuation already ran — don't fire again.
 *
 * This predicate only continues when:
 * - At least one client-interactive tool has output (user approved), AND
 * - No write-mutation tool has output yet (continuation hasn't run).
 */
import type { UIMessage } from 'ai';

/** Tools that require user approval before execution. */
const CLIENT_INTERACTIVE_TOOLS = new Set([
  'propose_issue',
  'propose_update_issue',
  'propose_bulk_update',
  'propose_comment',
]);

/**
 * Write-mutation tools that ONLY appear after a successful auto-continue
 * (the system prompt forbids calling them without prior propose_*).
 * Their presence with output = the continuation already executed.
 */
const WRITE_MUTATION_TOOLS = new Set([
  'create_issue',
  'update_issue',
  'bulk_update_issues',
  'add_comment',
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

  // Only consider interactive tools for the "should we continue" decision
  const interactiveParts = toolParts.filter((p) =>
    CLIENT_INTERACTIVE_TOOLS.has(toolNameOf(p)),
  );
  if (interactiveParts.length === 0) return false;

  // All interactive tools must have been approved (output available AND
  // output.approved === true). Cancelled proposals (approved: false) should
  // NOT trigger auto-continue — no mutation to run.
  const allInteractiveApproved = interactiveParts.every((p) => {
    if ((p as { state?: string }).state !== 'output-available') return false;
    const output = (p as { output?: { approved?: boolean } }).output;
    return output?.approved === true;
  });
  if (!allInteractiveApproved) return false;

  // LOOP GUARD: if any write-mutation tool already has output, the
  // continuation already ran (create_issue was executed). Don't fire again.
  // Read tools (search_issues, org_overview, etc.) can coexist with propose_*
  // in the initial turn — their presence does NOT mean continuation ran.
  const continuationAlreadyRan = toolParts.some(
    (p) =>
      WRITE_MUTATION_TOOLS.has(toolNameOf(p)) &&
      (p as { state?: string }).state === 'output-available',
  );
  if (continuationAlreadyRan) return false;

  return true;
}
