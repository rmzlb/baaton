import { lazy } from 'react';
import type { ComponentType } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolComponent = ComponentType<{ data: any; onAction?: (prompt: string) => void }>;

/**
 * Registry that maps backend component hints to lazily-loaded React components.
 * Each entry corresponds to a `component_hint` value from a `tool_result` SSE event.
 *
 * Adding a new tool:
 * 1. Create `src/components/ai/tool-components/<ComponentName>.tsx`
 * 2. Add an entry here.
 */
export const TOOL_COMPONENTS: Record<string, React.LazyExoticComponent<ToolComponent>> = {
  IssueTable: lazy(() => import('./IssueTable')),
  MetricsCard: lazy(() => import('./MetricsCard')),
  SprintAnalysis: lazy(() => import('./SprintAnalysis')),
  WeeklyRecap: lazy(() => import('./WeeklyRecap')),
  PriorityList: lazy(() => import('./PriorityList')),
  MilestoneTimeline: lazy(() => import('./MilestoneTimeline')),
  IssueCreated: lazy(() => import('./IssueCreated')),
  IssueUpdated: lazy(() => import('./IssueUpdated')),
  PRDDocument: lazy(() => import('./PRDDocument')),
};
