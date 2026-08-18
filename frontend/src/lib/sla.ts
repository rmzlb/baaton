import type { Issue, IssuePriority } from '@/lib/types';

export type SlaLevel = 'urgent' | 'high' | 'standard';
export type SlaStatus = 'ok' | 'at_risk' | 'breached' | 'paused' | 'completed';

export interface SlaPolicy {
  level: SlaLevel;
  labelKey: string;
  hours: number;
}

export interface SlaEvaluation {
  policy: SlaPolicy;
  status: SlaStatus;
  /** Absolute moment the remaining budget runs out. Undefined while paused. */
  deadline?: Date;
  /** Budget consumed so far, across every period the ball was in our court. */
  elapsedMs: number;
  /** Budget left. 0 once breached. */
  remainingMs: number;
  /** True when the clock is frozen waiting on the requester (`in_review`). */
  paused: boolean;
}

export interface DueDateEvaluation {
  date: Date;
  /** Calendar date passed and the issue is not finished. */
  overdue: boolean;
}

const SLA_POLICIES: Record<SlaLevel, SlaPolicy> = {
  urgent: { level: 'urgent', labelKey: 'sla.level.urgent', hours: 24 },
  high: { level: 'high', labelKey: 'sla.level.high', hours: 48 },
  standard: { level: 'standard', labelKey: 'sla.level.standard', hours: 120 },
};

function levelFromPriority(priority: IssuePriority | null): SlaLevel {
  if (priority === 'urgent') return 'urgent';
  if (priority === 'high') return 'high';
  return 'standard';
}

export function getSlaPolicy(priority: IssuePriority | null): SlaPolicy {
  return SLA_POLICIES[levelFromPriority(priority)];
}

/** Statuses that stop the clock for good. Mirrors `clock_runs` in the backend. */
function isTerminal(issue: Issue): boolean {
  if (issue.status_category === 'completed' || issue.status_category === 'canceled') return true;
  const s = issue.status.trim().toLowerCase().replace(/ /g, '_');
  return s === 'done' || s === 'cancelled' || s === 'canceled';
}

/** Statuses where the work is delivered and the requester has to validate. */
function isAwaitingRequester(issue: Issue): boolean {
  if (isTerminal(issue)) return false;
  const s = issue.status.trim().toLowerCase().replace(/ /g, '_');
  return s === 'in_review';
}

/**
 * Evaluate an issue's SLA.
 *
 * The clock measures time where the ball is in OUR court, not calendar time
 * since creation: it pauses on `in_review` (delivered, awaiting requester
 * validation) and stops on terminal statuses. Reopening resumes the same
 * budget where it left off rather than restarting or staying breached forever
 * — the behaviour Zendesk calls "requester wait time".
 *
 * Prefers the backend clock (`sla_elapsed_ms` / `sla_clock_started_at`, kept up
 * to date on every status and priority change). Falls back to
 * `status_changed_at` for issues not yet touched since migration 069, which is
 * still strictly better than the old `created_at` anchor.
 */
export function evaluateIssueSla(issue: Issue, now = new Date()): SlaEvaluation {
  const policy = getSlaPolicy(issue.priority ?? null);
  const budgetMs = policy.hours * 60 * 60 * 1000;

  const paused = isAwaitingRequester(issue);
  const terminal = isTerminal(issue);

  let elapsedMs: number;
  if (typeof issue.sla_elapsed_ms === 'number') {
    elapsedMs = issue.sla_elapsed_ms;
    // Add the currently open segment; the stored value only covers closed ones.
    if (issue.sla_clock_started_at) {
      const started = new Date(issue.sla_clock_started_at).getTime();
      elapsedMs += Math.max(0, now.getTime() - started);
    }
  } else {
    // Pre-069 fallback: time in the current status, not since creation.
    const anchor = new Date(issue.status_changed_at ?? issue.created_at).getTime();
    elapsedMs = Math.max(0, now.getTime() - anchor);
  }

  const remainingMs = Math.max(0, budgetMs - elapsedMs);
  // Sticky, like the backend: a breach stays a breach after completion.
  const breached = issue.sla_breached === true || elapsedMs > budgetMs;

  if (terminal) {
    return {
      policy,
      status: breached ? 'breached' : 'completed',
      elapsedMs,
      remainingMs,
      paused: false,
    };
  }

  if (breached) {
    return { policy, status: 'breached', elapsedMs, remainingMs: 0, paused };
  }

  if (paused) {
    // No deadline while frozen: it would drift forward on every render.
    return { policy, status: 'paused', elapsedMs, remainingMs, paused: true };
  }

  const deadline = new Date(now.getTime() + remainingMs);
  const atRiskThresholdMs = budgetMs * 0.25;

  return {
    policy,
    status: remainingMs <= atRiskThresholdMs ? 'at_risk' : 'ok',
    deadline,
    elapsedMs,
    remainingMs,
    paused: false,
  };
}

/**
 * Evaluate the due date, kept separate from the SLA on purpose.
 *
 * A due date is an absolute commitment to a calendar date: it does not pause
 * because the requester is slow to review. Merging it into the SLA (the old
 * `min(deadline, due_date)`) conflated "how fast we react" with "when it ships"
 * and made both unreadable.
 */
export function evaluateDueDate(issue: Issue, now = new Date()): DueDateEvaluation | null {
  if (!issue.due_date) return null;
  const date = new Date(issue.due_date);
  return { date, overdue: !isTerminal(issue) && date.getTime() < now.getTime() };
}
