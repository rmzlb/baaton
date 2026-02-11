import type { Issue, IssuePriority } from '@/lib/types';

export type SlaLevel = 'urgent' | 'high' | 'standard';
export type SlaStatus = 'ok' | 'at_risk' | 'breached' | 'completed';

export interface SlaPolicy {
  level: SlaLevel;
  labelKey: string;
  hours: number;
}

export interface SlaEvaluation {
  policy: SlaPolicy;
  status: SlaStatus;
  deadline: Date;
  dueDateDeadline?: Date;
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

export function evaluateIssueSla(issue: Issue, now = new Date()): SlaEvaluation {
  const policy = getSlaPolicy(issue.priority ?? null);
  const createdAt = new Date(issue.created_at);
  const computedDeadline = new Date(createdAt.getTime() + policy.hours * 60 * 60 * 1000);
  const dueDateDeadline = issue.due_date ? new Date(issue.due_date) : undefined;
  const deadline = dueDateDeadline && dueDateDeadline < computedDeadline ? dueDateDeadline : computedDeadline;

  if (issue.status === 'done' || issue.status === 'cancelled') {
    return { policy, status: 'completed', deadline, dueDateDeadline };
  }

  const remainingMs = deadline.getTime() - now.getTime();
  const atRiskThresholdMs = policy.hours * 60 * 60 * 1000 * 0.25;

  if (remainingMs < 0) {
    return { policy, status: 'breached', deadline, dueDateDeadline };
  }
  if (remainingMs <= atRiskThresholdMs) {
    return { policy, status: 'at_risk', deadline, dueDateDeadline };
  }

  return { policy, status: 'ok', deadline, dueDateDeadline };
}
