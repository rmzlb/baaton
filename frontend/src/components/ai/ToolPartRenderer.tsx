import { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import ToolResultFallback from './tool-components/ToolResultFallback';

const IssueProposal = lazy(() => import('./tool-components/IssueProposal'));
const UpdateIssueProposal = lazy(() => import('./tool-components/UpdateIssueProposal'));
const BulkUpdateProposal = lazy(() => import('./tool-components/BulkUpdateProposal'));
const CommentProposal = lazy(() => import('./tool-components/CommentProposal'));
const IssueTable = lazy(() => import('./tool-components/IssueTable'));
const MetricsCard = lazy(() => import('./tool-components/MetricsCard'));
const SprintAnalysis = lazy(() => import('./tool-components/SprintAnalysis'));
const WeeklyRecap = lazy(() => import('./tool-components/WeeklyRecap'));
const PriorityList = lazy(() => import('./tool-components/PriorityList'));
const MilestoneTimeline = lazy(() => import('./tool-components/MilestoneTimeline'));
const IssueCreated = lazy(() => import('./tool-components/IssueCreated'));
const IssueUpdated = lazy(() => import('./tool-components/IssueUpdated'));
const PRDDocument = lazy(() => import('./tool-components/PRDDocument'));

type AnyToolPart = ToolUIPart | DynamicToolUIPart;

function getToolName(part: AnyToolPart): string {
  if (part.type === 'dynamic-tool') return (part as DynamicToolUIPart).toolName;
  return part.type.replace(/^tool-/, '');
}

interface ToolPartRendererProps {
  part: AnyToolPart;
  addToolOutput: (opts: { tool: string; toolCallId: string; output: unknown }) => void;
  inBatch?: boolean;
}

const PROPOSAL_TOOLS = new Set([
  'propose_issue',
  'propose_update_issue',
  'propose_bulk_update',
  'propose_comment',
]);

export function ToolPartRenderer({ part, addToolOutput, inBatch }: ToolPartRendererProps) {
  const toolName = getToolName(part);
  const dynPart = part as DynamicToolUIPart;

  const content = renderContent(toolName, part, dynPart, addToolOutput, inBatch);
  return <div className="animate-tool-in">{content}</div>;
}

function renderContent(
  toolName: string,
  part: ToolPartRendererProps['part'],
  dynPart: DynamicToolUIPart,
  addToolOutput: ToolPartRendererProps['addToolOutput'],
  inBatch?: boolean,
) {
  if (part.state === 'input-streaming' && !PROPOSAL_TOOLS.has(toolName)) {
    return <ExecutingIndicator name={toolName} />;
  }

  switch (toolName) {
    case 'propose_issue':
      return <Suspense fallback={<Skeleton />}><IssueProposal part={dynPart} addToolOutput={addToolOutput} inBatch={inBatch} /></Suspense>;
    case 'propose_update_issue':
      return <Suspense fallback={<Skeleton />}><UpdateIssueProposal part={dynPart} addToolOutput={addToolOutput} inBatch={inBatch} /></Suspense>;
    case 'propose_bulk_update':
      return <Suspense fallback={<Skeleton />}><BulkUpdateProposal part={dynPart} addToolOutput={addToolOutput} inBatch={inBatch} /></Suspense>;
    case 'propose_comment':
      return <Suspense fallback={<Skeleton />}><CommentProposal part={dynPart} addToolOutput={addToolOutput} inBatch={inBatch} /></Suspense>;
  }

  if (part.state === 'input-streaming' || part.state === 'input-available') {
    return <ExecutingIndicator name={toolName} />;
  }

  if (part.state === 'output-available') {
    const output = part.output as Record<string, unknown> | undefined;
    const data = (output?.data ?? output) as Record<string, unknown>;

    switch (toolName) {
      case 'search_issues':
        return <Suspense fallback={<Skeleton />}><IssueTable data={data} /></Suspense>;
      case 'get_project_metrics':
        return <Suspense fallback={<Skeleton />}><MetricsCard data={data} /></Suspense>;
      case 'analyze_sprint':
        return <Suspense fallback={<Skeleton />}><SprintAnalysis data={data} /></Suspense>;
      case 'weekly_recap':
        return <Suspense fallback={<Skeleton />}><WeeklyRecap data={data} /></Suspense>;
      case 'suggest_priorities':
        return <Suspense fallback={<Skeleton />}><PriorityList data={data} /></Suspense>;
      case 'plan_milestones':
        return <Suspense fallback={<Skeleton />}><MilestoneTimeline data={data} /></Suspense>;
      case 'create_issue':
        return <Suspense fallback={<Skeleton />}><IssueCreated data={data} /></Suspense>;
      case 'update_issue':
        return <Suspense fallback={<Skeleton />}><IssueUpdated data={data} /></Suspense>;
      case 'generate_prd':
        return <Suspense fallback={<Skeleton />}><PRDDocument data={data} /></Suspense>;
    }

    const summary = typeof output?.summary === 'string' ? output.summary : undefined;
    if (summary) {
      return <ToolResultFallback summary={summary} />;
    }
  }

  if (part.state === 'output-error') {
    return (
      <Tool defaultOpen>
        <ToolHeader type="dynamic-tool" state={part.state} toolName={toolName} />
        <ToolContent>
          <ToolInput input={part.input} />
          <ToolOutput output={undefined} errorText={(part as DynamicToolUIPart).errorText ?? 'Tool failed'} />
        </ToolContent>
      </Tool>
    );
  }

  return (
    <Tool defaultOpen={false}>
      <ToolHeader type="dynamic-tool" state={part.state} toolName={toolName} />
      <ToolContent>
        <ToolInput input={part.input} />
        {part.state === 'output-available' && (
          <ToolOutput output={JSON.stringify(part.output, null, 2)} errorText={undefined} />
        )}
      </ToolContent>
    </Tool>
  );
}

function ExecutingIndicator({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-[--color-surface-hover]/50 px-3 py-1.5 text-[11px] text-[--color-muted]">
      <Loader2 size={12} className="animate-spin text-amber-500" />
      <span className="capitalize">{name.replace(/_/g, ' ')}...</span>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2 animate-pulse rounded-lg p-3">
      <div className="h-3 w-3/4 rounded bg-[--color-surface-hover]" />
      <div className="h-3 w-1/2 rounded bg-[--color-surface-hover]" />
    </div>
  );
}
