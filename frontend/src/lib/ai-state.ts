/**
 * Baaton AI State Machine — Lightweight conversation state tracking.
 * Follows Manus/XState pattern from HelmAI (without XState dependency).
 *
 * State transitions drive tool masking and conversation behavior.
 */

import type { SkillContext } from './ai-skills';

// ─── States ───────────────────────────────────
export type AIConversationState =
  | 'idle'           // No active conversation
  | 'chatting'       // Normal Q&A
  | 'planning'       // plan_milestones executing
  | 'plan_proposed'  // Plan shown, waiting for confirm/adjust
  | 'executing'      // Batch operations running
  | 'reporting'      // Generating metrics/recap/PRD
  | 'error';         // Error state, can retry

// ─── Context ──────────────────────────────────
export interface AIStateContext {
  state: AIConversationState;
  lastSkills: string[];           // Last 5 skills executed
  pendingPlan?: {                 // Cached plan data for confirm step
    projectId: string;
    milestones: Array<{
      name: string;
      description?: string;
      target_date?: string;
      order?: number;
      issue_ids: string[];
    }>;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    turnCount: number;
    skillCalls: number;
  };
  startedAt: number;
  lastActivityAt: number;
  errorCount: number;
}

// ─── Token Budget ─────────────────────────────
export const TOKEN_BUDGET = {
  maxPerSession: 100_000,
  warnAt: 80_000,
  maxConversationHistory: 20,
  summarizeAfter: 16,
};

// ─── Rate Limiting ────────────────────────────
const RATE_LIMIT = { maxPerMinute: 10, maxPerHour: 100 };
const callTimestamps: number[] = [];

export function checkRateLimit(): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  // Clean old timestamps
  while (callTimestamps.length > 0 && now - callTimestamps[0] > 3_600_000) {
    callTimestamps.shift();
  }
  const lastMinute = callTimestamps.filter((t) => now - t < 60_000);
  if (lastMinute.length >= RATE_LIMIT.maxPerMinute) {
    const oldest = lastMinute[0];
    return { allowed: false, retryAfterMs: 60_000 - (now - oldest) };
  }
  if (callTimestamps.length >= RATE_LIMIT.maxPerHour) {
    return { allowed: false, retryAfterMs: 3_600_000 - (now - callTimestamps[0]) };
  }
  callTimestamps.push(now);
  return { allowed: true };
}

// ─── Token Estimation ─────────────────────────
export function estimateTokens(text: string): number {
  // ~4 chars per token for English, ~3 for French
  return Math.ceil(text.length / 3.5);
}

// ─── State Factory ────────────────────────────
export function createInitialState(): AIStateContext {
  return {
    state: 'idle',
    lastSkills: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      turnCount: 0,
      skillCalls: 0,
    },
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    errorCount: 0,
  };
}

// ─── State Transitions ────────────────────────
export function transition(
  ctx: AIStateContext,
  event:
    | { type: 'USER_MESSAGE'; tokens: number }
    | { type: 'SKILL_STARTED'; name: string }
    | { type: 'SKILL_COMPLETED'; name: string; data?: unknown }
    | { type: 'SKILL_FAILED'; name: string; error: string }
    | { type: 'AI_RESPONSE'; tokens: number }
    | { type: 'ERROR'; error: string }
    | { type: 'RESET' },
): AIStateContext {
  const next = { ...ctx, lastActivityAt: Date.now() };

  switch (event.type) {
    case 'USER_MESSAGE':
      next.usage = {
        ...next.usage,
        inputTokens: next.usage.inputTokens + event.tokens,
        totalTokens: next.usage.totalTokens + event.tokens,
        turnCount: next.usage.turnCount + 1,
      };
      if (next.state === 'idle' || next.state === 'error') {
        next.state = 'chatting';
      }
      break;

    case 'SKILL_STARTED':
      next.usage = { ...next.usage, skillCalls: next.usage.skillCalls + 1 };
      if (event.name === 'plan_milestones') {
        next.state = 'planning';
      } else if (event.name === 'create_milestones_batch' || event.name === 'bulk_update_issues') {
        next.state = 'executing';
      } else if (['get_project_metrics', 'analyze_sprint', 'weekly_recap'].includes(event.name)) {
        next.state = 'reporting';
      }
      break;

    case 'SKILL_COMPLETED':
      next.lastSkills = [...next.lastSkills.slice(-4), event.name];
      if (event.name === 'plan_milestones' && event.data) {
        next.state = 'plan_proposed';
        // Cache plan data
        const d = event.data as { project_id?: string; proposed_milestones?: unknown[] };
        if (d.project_id && d.proposed_milestones) {
          next.pendingPlan = {
            projectId: d.project_id,
            milestones: d.proposed_milestones as NonNullable<AIStateContext['pendingPlan']>['milestones'],
          };
        }
      } else if (event.name === 'create_milestones_batch') {
        next.state = 'chatting';
        next.pendingPlan = undefined;
      } else {
        next.state = 'chatting';
      }
      next.errorCount = 0;
      break;

    case 'SKILL_FAILED':
      next.lastSkills = [...next.lastSkills.slice(-4), event.name];
      next.errorCount++;
      if (next.errorCount >= 3) {
        next.state = 'error';
      } else {
        next.state = 'chatting';
      }
      break;

    case 'AI_RESPONSE':
      next.usage = {
        ...next.usage,
        outputTokens: next.usage.outputTokens + event.tokens,
        totalTokens: next.usage.totalTokens + event.tokens,
      };
      break;

    case 'ERROR':
      next.state = 'error';
      next.errorCount++;
      break;

    case 'RESET':
      return createInitialState();
  }

  return next;
}

// ─── State → Tool Masking Context ─────────────
export function stateToSkillContext(ctx: AIStateContext): SkillContext {
  switch (ctx.state) {
    case 'plan_proposed':
      return 'milestone_confirm';
    case 'planning':
      return 'milestone_planning';
    case 'reporting':
      return 'read_only';
    default:
      return 'default';
  }
}

// ─── Conversation Summarization ───────────────
// When history exceeds threshold, compress middle messages
export function summarizeHistory(
  history: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  if (history.length <= TOKEN_BUDGET.summarizeAfter) {
    return history;
  }

  // Keep first 2 (context) + last 6 (recent), summarize middle
  const first = history.slice(0, 2);
  const last = history.slice(-6);
  const middle = history.slice(2, -6);

  // Build summary of middle messages
  const userMessages = middle.filter((m) => m.role === 'user').map((m) => m.content);
  const aiTopics = middle
    .filter((m) => m.role === 'assistant')
    .map((m) => {
      const firstLine = m.content.split('\n')[0];
      return firstLine.length > 100 ? firstLine.slice(0, 100) + '...' : firstLine;
    });

  const summary = [
    `[CONVERSATION SUMMARY - ${middle.length} messages compressed]`,
    `User discussed: ${userMessages.slice(0, 5).join('; ')}`,
    `AI covered: ${aiTopics.slice(0, 5).join('; ')}`,
  ].join('\n');

  return [
    ...first,
    { role: 'user', content: summary },
    { role: 'assistant', content: 'Understood. I have the context from our previous discussion.' },
    ...last,
  ];
}

// ─── Budget Check ─────────────────────────────
export function checkBudget(ctx: AIStateContext): {
  ok: boolean;
  warning?: string;
  percentUsed: number;
} {
  const pct = Math.round((ctx.usage.totalTokens / TOKEN_BUDGET.maxPerSession) * 100);
  if (ctx.usage.totalTokens >= TOKEN_BUDGET.maxPerSession) {
    return { ok: false, warning: 'Token budget exceeded. Please start a new conversation.', percentUsed: pct };
  }
  if (ctx.usage.totalTokens >= TOKEN_BUDGET.warnAt) {
    return { ok: true, warning: `${pct}% of token budget used. Consider starting a new conversation soon.`, percentUsed: pct };
  }
  return { ok: true, percentUsed: pct };
}

// ─── Convenience Aliases (used by ai-engine.ts) ──

/** Reset state to initial. */
export const resetState = createInitialState;

/** Record a skill execution in state context. */
export function recordSkillExecution(
  ctx: AIStateContext,
  skillName: string,
  data?: unknown,
): AIStateContext {
  return transition(
    transition(ctx, { type: 'SKILL_STARTED', name: skillName }),
    { type: 'SKILL_COMPLETED', name: skillName, data },
  );
}

/** Record token usage in state context. */
export function recordTokenUsage(
  ctx: AIStateContext,
  inputTokens: number,
  outputTokens: number,
): AIStateContext {
  let next = transition(ctx, { type: 'USER_MESSAGE', tokens: inputTokens });
  next = transition(next, { type: 'AI_RESPONSE', tokens: outputTokens });
  return next;
}

/** Increment turn counter. */
export function incrementTurn(ctx: AIStateContext): AIStateContext {
  return transition(ctx, { type: 'USER_MESSAGE', tokens: 0 });
}

/** Derive skill context from state + user message. */
export function deriveSkillContext(
  ctx: AIStateContext,
  _userMessage: string,
): SkillContext {
  return stateToSkillContext(ctx);
}

/** Check if approaching token budget. */
export function isApproachingTokenBudget(ctx: AIStateContext): boolean {
  const { ok, warning } = checkBudget(ctx);
  return !ok || !!warning;
}
