/**
 * AIAssistant — Sidebar AI Panel
 *
 * Rewritten to use useAgentChat() hook + AI Elements (ToolResultRenderer).
 * - Gemini mode: backend agent via POST /api/v1/ai/agent (SSE stream)
 * - OpenClaw mode: openclaw-engine (external relay)
 * - PmPlanResultPanel preserved for pm-full-review results
 * - ChainOfThought removed (handled by AI Elements now)
 * - PendingActionPanel removed (tool execution is server-side now)
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, X, Send, Trash2, Bot, User, Loader2,
  Wrench, ChevronDown, Wifi, WifiOff,
} from 'lucide-react';
import {
  Conversation,
  ConversationBody,
  ConversationFooter,
  ConversationHeader,
} from '@/components/ai/Conversation';
import { useAuth } from '@clerk/clerk-react';
import { useAIAssistantStore } from '@/stores/ai-assistant';
import { useNotificationStore } from '@/stores/notifications';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { useAgentChat, type AgentMessage } from '@/hooks/useAgentChat';
import { ToolResultRenderer } from '@/components/ai/ToolResultRenderer';
import {
  getOpenClawConfig,
  sendToOpenClaw,
  OpenClawError,
  type OpenClawConfig,
} from '@/lib/openclaw-engine';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/shared/MarkdownView';
import {
  PmPlanResultPanel,
  type PmPlanUiState,
  type PmReviewPlanData,
} from '@/components/ai/PmPlanResultPanel';
import { TOOL_SCHEMAS } from '@/lib/ai-skills';
import type { Milestone, Sprint } from '@/lib/types';

// ─── Types ────────────────────────────────────

type AIMode = 'gemini' | 'openclaw';

interface OcMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// ─── PM Plan helpers ──────────────────────────

interface PmPlanApplyPayload {
  projects: Array<{
    project_id: string;
    milestones: Array<{
      key?: string;
      name: string;
      description?: string;
      target_date?: string;
      issue_ids: string[];
    }>;
    sprints: Array<{
      key?: string;
      name: string;
      goal?: string;
      start_date?: string;
      end_date?: string;
      issue_ids: string[];
    }>;
  }>;
}

function isPmReviewPlanData(value: unknown): value is PmReviewPlanData {
  if (!value || typeof value !== 'object') return false;
  const maybePlan = value as { projects?: unknown[] };
  return Array.isArray(maybePlan.projects);
}

function buildPmApplyPayloadFromReview(plan: PmReviewPlanData): PmPlanApplyPayload {
  const sprintByKey = new Map(plan.sprint_windows.map((window) => [window.key, window]));

  const milestoneTargetDateByKey: Record<string, string | undefined> = {
    milestone_a: sprintByKey.get('sprint1')?.end_date,
    milestone_b: sprintByKey.get('sprint2')?.end_date,
    milestone_c: sprintByKey.get('sprint3')?.end_date ?? plan.period.end_date,
  };

  return {
    projects: plan.projects.map((project) => ({
      project_id: project.project_id,
      milestones: project.milestones.map((milestone) => ({
        key: milestone.key,
        name: milestone.name,
        target_date: milestoneTargetDateByKey[milestone.key],
        issue_ids: milestone.issues.map((issue) => issue.id),
      })),
      sprints: project.sprints.map((sprint) => ({
        key: sprint.key,
        name: sprint.name,
        start_date: sprint.start_date,
        end_date: sprint.end_date,
        issue_ids: sprint.issues.map((issue) => issue.id),
      })),
    })),
  };
}

function serializePmPlanDraft(payload: PmPlanApplyPayload): string {
  return JSON.stringify(payload, null, 2);
}

function parsePmPlanDraft(draft: string): PmPlanApplyPayload | null {
  const normalized = draft.trim();
  if (!normalized) return null;

  const parseJson = (input: string): PmPlanApplyPayload | null => {
    try {
      const parsed: unknown = JSON.parse(input);
      if (!parsed || typeof parsed !== 'object') return null;
      const payload = parsed as { projects?: unknown };
      if (!Array.isArray(payload.projects)) return null;
      return parsed as PmPlanApplyPayload;
    } catch {
      return null;
    }
  };

  const direct = parseJson(normalized);
  if (direct) return direct;

  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fencedMatch) return null;

  return parseJson(fencedMatch[1]?.trim() ?? '');
}

function createDefaultPmPlanState(initialDraft = ''): PmPlanUiState {
  return {
    isEditing: false,
    draft: initialDraft,
    applying: false,
    stage: 'idle',
    dismissed: false,
    applied: false,
    error: null,
  };
}

// ─── Suggestions ──────────────────────────────

function useSuggestions() {
  const { t } = useTranslation();
  return [
    { label: t('ai.suggestionSummary'), prompt: t('ai.suggestionSummaryPrompt') },
    { label: t('ai.suggestionTriage'), prompt: t('ai.suggestionTriagePrompt') },
    { label: t('ai.suggestionCreate'), prompt: t('ai.suggestionCreatePrompt') },
    { label: t('ai.suggestionAutomation'), prompt: t('ai.suggestionAutomationPrompt') },
    { label: t('ai.suggestionSprint'), prompt: t('ai.suggestionSprintPrompt') },
    { label: t('ai.suggestionRecap'), prompt: t('ai.suggestionRecapPrompt') },
  ];
}

// ─── Typing Indicator ─────────────────────────

function TypingIndicator() {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-secondary mt-0.5">
        <Bot size={12} />
      </div>
      <div className="rounded-lg bg-surface border border-border px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin text-accent" />
          <span className="text-xs text-muted">{t('ai.analyzing')}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Agent Message Bubble ─────────────────────

interface AgentMessageBubbleProps {
  message: AgentMessage;
  onAction?: (prompt: string) => void;
  onPmPlanAccept?: (messageId: string, plan: PmReviewPlanData) => void;
  onPmPlanEdit?: (messageId: string, initialDraft: string) => void;
  onPmPlanApplyChanges?: (messageId: string, draft: string) => void;
  onPmPlanCancel?: (messageId: string) => void;
  onPmPlanDraftChange?: (messageId: string, draft: string) => void;
  getPmPlanState?: (messageId: string, initialDraft: string) => PmPlanUiState;
}

function AgentMessageBubble({
  message,
  onAction,
  onPmPlanAccept,
  onPmPlanEdit,
  onPmPlanApplyChanges,
  onPmPlanCancel,
  onPmPlanDraftChange,
  getPmPlanState,
}: AgentMessageBubbleProps) {
  const isUser = message.role === 'user';
  const { t } = useTranslation();

  // Extract pm_full_review result from tool calls (sidebar shows PmPlanResultPanel)
  const pmPlanCall = !isUser
    ? message.toolCalls?.find((tc) => tc.name === 'pm_full_review' && tc.status === 'done')
    : undefined;
  const pmPlan = isPmReviewPlanData(pmPlanCall?.result?.data) ? pmPlanCall!.result!.data : null;
  const initialPmDraft = pmPlan ? serializePmPlanDraft(buildPmApplyPayloadFromReview(pmPlan)) : '';
  const pmState = pmPlan && getPmPlanState
    ? getPmPlanState(message.id, initialPmDraft)
    : createDefaultPmPlanState(initialPmDraft);

  // Tool calls to render (excluding pm_full_review — shown as PmPlanResultPanel)
  const toolCalls = !isUser
    ? (message.toolCalls ?? []).filter((tc) => tc.name !== 'pm_full_review')
    : [];

  // Detect milestone plan proposal / creation from tool calls
  const planMilestonesCall = !isUser
    ? message.toolCalls?.find((tc) => tc.name === 'plan_milestones' && tc.status === 'done')
    : undefined;
  const hasCreatedMilestones = !isUser
    && message.toolCalls?.some((tc) => tc.name === 'create_milestones_batch' && tc.status === 'done');

  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      <div className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full mt-0.5',
        isUser ? 'bg-accent/20 text-accent' : 'bg-surface-hover text-secondary',
      )}>
        {isUser ? <User size={12} /> : <Bot size={12} />}
      </div>

      <div className="max-w-[88%] space-y-1.5">
        {/* Tool calls via ToolResultRenderer */}
        {toolCalls.length > 0 && (
          <div className="space-y-1">
            {toolCalls.map((tc) => (
              <ToolResultRenderer key={tc.id} event={tc} />
            ))}
          </div>
        )}

        {/* Text content */}
        {message.content && (
          <div className={cn(
            'rounded-lg px-3 py-2',
            isUser ? 'bg-accent text-black' : 'bg-surface border border-border',
          )}>
            {isUser ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="text-sm">
                <MarkdownView content={message.content} />
              </div>
            )}
          </div>
        )}

        {/* PM full-review plan panel */}
        {pmPlan && onPmPlanAccept && onPmPlanEdit && onPmPlanApplyChanges && onPmPlanCancel && onPmPlanDraftChange && (
          <PmPlanResultPanel
            plan={pmPlan}
            state={pmState}
            onAccept={() => onPmPlanAccept(message.id, pmPlan)}
            onEdit={() => onPmPlanEdit(message.id, initialPmDraft)}
            onApplyChanges={() => onPmPlanApplyChanges(message.id, pmState.draft)}
            onCancel={() => onPmPlanCancel(message.id)}
            onDraftChange={(draft) => onPmPlanDraftChange(message.id, draft)}
          />
        )}

        {/* Milestone plan action buttons */}
        {planMilestonesCall && onAction && (() => {
          const planData = planMilestonesCall.result?.data as {
            project_id?: string;
            proposed_milestones?: Array<{ name: string; description?: string; target_date?: string; order?: number; issue_ids: string[] }>;
          } | undefined;
          const hasProposed = planData?.proposed_milestones && planData.proposed_milestones.length > 0;

          return (
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => {
                  if (hasProposed) {
                    onAction(`Yes, apply the plan now. Call create_milestones_batch with project_id="${planData!.project_id}" and these milestones: ${JSON.stringify(planData!.proposed_milestones)}`);
                  } else {
                    onAction('Yes, apply this milestone plan. Create all the milestones and assign the issues as proposed.');
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 transition-colors"
              >
                {t('milestones.applyPlan')}
              </button>
              <button
                onClick={() => onAction('Adjust the plan: I want fewer milestones, merge the smaller ones together and re-prioritize.')}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-secondary hover:bg-gray-50 dark:hover:bg-surface-hover transition-colors"
              >
                {t('milestones.adjustPlan')}
              </button>
            </div>
          );
        })()}

        {/* Milestone creation confirmation */}
        {hasCreatedMilestones && (
          <div className="flex items-center gap-1.5 mt-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-3 py-1.5">
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{t('milestones.planApplied')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Simple OC Message Bubble ─────────────────

function OcMessageBubble({ message }: { message: OcMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      <div className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full mt-0.5',
        isUser ? 'bg-accent/20 text-accent' : 'bg-surface-hover text-secondary',
      )}>
        {isUser ? <User size={12} /> : <Bot size={12} />}
      </div>
      <div className={cn(
        'max-w-[88%] rounded-lg px-3 py-2',
        isUser ? 'bg-accent text-black' : 'bg-surface border border-border',
      )}>
        {isUser ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="text-sm">
            <MarkdownView content={message.content} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────

export function AIAssistant() {
  const { t } = useTranslation();
  const SUGGESTIONS = useSuggestions();
  const {
    open, input,
    toggle, setOpen, setInput,
  } = useAIAssistantStore();

  const [aiMode, setAiMode] = useState<AIMode>('gemini');
  const [authToken, setAuthToken] = useState('');
  const [pmPlanStates, setPmPlanStates] = useState<Record<string, PmPlanUiState>>({});

  // OpenClaw mode: simple local messages
  const [ocMessages, setOcMessages] = useState<OcMessage[]>([]);
  const [ocLoading, setOcLoading] = useState(false);

  const apiClient = useApi();
  const queryClient = useQueryClient();
  const addNotification = useNotificationStore((state) => state.addNotification);
  const { getToken } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // OpenClaw config
  const [openclawConfig, setOpenclawConfig] = useState<OpenClawConfig | null>(getOpenClawConfig);
  useEffect(() => {
    setOpenclawConfig(getOpenClawConfig());
  }, [open]);

  // Fetch & refresh auth token for useAgentChat
  useEffect(() => {
    getToken().then((t) => { if (t) setAuthToken(t); });
    const id = setInterval(() => {
      getToken().then((t) => { if (t) setAuthToken(t); });
    }, 50 * 60 * 1000);
    return () => clearInterval(id);
  }, [getToken]);

  // Fetch projects
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Fetch issues for OpenClaw context
  const { data: allIssuesByProject = {} } = useQuery({
    queryKey: ['all-issues-for-ai', projects.map((p) => p.id).join(',')],
    queryFn: async () => {
      const result: Record<string, { status: string }[]> = {};
      await Promise.all(
        projects.map(async (project) => {
          try {
            result[project.id] = await apiClient.issues.listByProject(project.id, { limit: 500 });
          } catch {
            result[project.id] = [];
          }
        }),
      );
      return result;
    },
    enabled: projects.length > 0,
    staleTime: 30_000,
  });

  // useAgentChat for gemini mode
  const {
    messages: agentMessages,
    sendMessage: agentSend,
    isStreaming,
    error: agentError,
    clearMessages: clearAgentMessages,
  } = useAgentChat({
    projectIds: projects.map((p) => p.id),
    authToken,
    onComplete: (usage) => {
      // Invalidate queries after tool execution
      queryClient.invalidateQueries({ queryKey: ['issues'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['milestones'], refetchType: 'all' });
      void usage;
    },
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [agentMessages, ocMessages, isStreaming, ocLoading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  const openclawConnected = openclawConfig?.status === 'connected';
  const skillCount = Object.keys(TOOL_SCHEMAS).length;

  // Clear all messages (both modes)
  const handleClearMessages = useCallback(() => {
    clearAgentMessages();
    setOcMessages([]);
    setPmPlanStates({});
  }, [clearAgentMessages]);

  // Send in OpenClaw mode
  const handleSendOpenClaw = useCallback(async (msg: string) => {
    if (!openclawConfig || !openclawConnected) {
      setOcMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `⚠️ ${t('ai.openclawNotConnected')}`,
      }]);
      return;
    }

    try {
      const contextParts: string[] = [`[Baaton Board Context — ${projects.length} projects]`];
      for (const p of projects) {
        const issues = allIssuesByProject[p.id] ?? [];
        const byStatus: Record<string, number> = {};
        for (const issue of issues) byStatus[issue.status] = (byStatus[issue.status] || 0) + 1;
        const statusSummary = Object.entries(byStatus).map(([s, c]) => `${s}: ${c}`).join(', ');
        contextParts.push(`- ${p.name} (${p.prefix}): ${issues.length} issues [${statusSummary}]`);
      }

      const response = await sendToOpenClaw(msg, openclawConfig, { context: contextParts.join('\n') });
      setOcMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: response.text }]);
    } catch (err) {
      const errorMsg = err instanceof OpenClawError
        ? (err.isConnectionError ? t('ai.openclawConnectionError') : err.message)
        : (err instanceof Error ? err.message : t('ai.errorGeneric'));
      setOcMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `⚠️ ${t('ai.error', { message: errorMsg })}`,
      }]);
    }
  }, [openclawConfig, openclawConnected, projects, allIssuesByProject, t]);

  // Main send handler
  const handleSend = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isStreaming || ocLoading) return;

    setInput('');

    if (aiMode === 'openclaw') {
      setOcMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: msg }]);
      setOcLoading(true);
      try {
        await handleSendOpenClaw(msg);
      } finally {
        setOcLoading(false);
      }
      return;
    }

    // Gemini mode: delegate to useAgentChat
    await agentSend(msg);
  }, [input, isStreaming, ocLoading, aiMode, setInput, agentSend, handleSendOpenClaw]);

  // ── PM Plan state management ──────────────────────────────────────────────

  const getPmPlanState = useCallback((messageId: string, initialDraft: string): PmPlanUiState => {
    return pmPlanStates[messageId] ?? createDefaultPmPlanState(initialDraft);
  }, [pmPlanStates]);

  const updatePmPlanState = useCallback((messageId: string, updater: (prev: PmPlanUiState) => PmPlanUiState) => {
    setPmPlanStates((prev) => {
      const current = prev[messageId] ?? createDefaultPmPlanState('');
      return { ...prev, [messageId]: updater(current) };
    });
  }, []);

  const applyPmPlanPayload = useCallback(async (payload: PmPlanApplyPayload) => {
    const createdMilestones: Milestone[] = [];
    const createdSprints: Sprint[] = [];
    const updatesByIssueId = new Map<string, { milestone_id?: string | null; sprint_id?: string | null }>();

    for (const project of payload.projects) {
      const milestoneIdByKey = new Map<string, string>();
      const sprintIdByKey = new Map<string, string>();

      for (const milestone of project.milestones) {
        const created = await apiClient.milestones.create(project.project_id, {
          name: milestone.name,
          description: milestone.description,
          target_date: milestone.target_date,
          status: 'planned',
        });
        createdMilestones.push(created);
        if (milestone.key) milestoneIdByKey.set(milestone.key, created.id);
        for (const issueId of milestone.issue_ids) {
          updatesByIssueId.set(issueId, { ...updatesByIssueId.get(issueId), milestone_id: created.id });
        }
      }

      for (const sprint of project.sprints) {
        const created = await apiClient.sprints.create(project.project_id, {
          name: sprint.name,
          goal: sprint.goal,
          start_date: sprint.start_date,
          end_date: sprint.end_date,
          status: 'planned',
        });
        createdSprints.push(created);
        if (sprint.key) sprintIdByKey.set(sprint.key, created.id);
        for (const issueId of sprint.issue_ids) {
          updatesByIssueId.set(issueId, { ...updatesByIssueId.get(issueId), sprint_id: created.id });
        }
      }

      void milestoneIdByKey;
      void sprintIdByKey;
    }

    for (const [issueId, update] of updatesByIssueId.entries()) {
      await apiClient.issues.update(issueId, update);
    }

    return {
      milestonesCreated: createdMilestones.length,
      sprintsCreated: createdSprints.length,
      issuesUpdated: updatesByIssueId.size,
    };
  }, [apiClient]);

  const invalidatePmQueries = useCallback(() => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['issues'] }),
    queryClient.invalidateQueries({ queryKey: ['all-issues'] }),
    queryClient.invalidateQueries({ queryKey: ['milestones'] }),
    queryClient.invalidateQueries({ queryKey: ['sprints'] }),
    queryClient.invalidateQueries({ queryKey: ['roadmap-items'] }),
  ]), [queryClient]);

  const handlePmPlanAccept = useCallback(async (messageId: string, plan: PmReviewPlanData) => {
    const payload = buildPmApplyPayloadFromReview(plan);
    updatePmPlanState(messageId, (prev) => ({
      ...prev, applying: true, stage: 'validating', dismissed: false, applied: false, error: null,
      draft: prev.draft || serializePmPlanDraft(payload),
    }));
    try {
      await new Promise((r) => setTimeout(r, 180));
      updatePmPlanState(messageId, (prev) => ({ ...prev, stage: 'persisting' }));
      const result = await applyPmPlanPayload(payload);
      updatePmPlanState(messageId, (prev) => ({ ...prev, stage: 'refreshing' }));
      await invalidatePmQueries();
      updatePmPlanState(messageId, (prev) => ({ ...prev, applying: false, stage: 'success', applied: true }));
      addNotification({
        type: 'success',
        title: t('ai.pmPlan.appliedTitle'),
        message: t('ai.pmPlan.appliedMessage', {
          milestones: String(result.milestonesCreated),
          sprints: String(result.sprintsCreated),
          issues: String(result.issuesUpdated),
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('ai.pmPlan.applyError');
      updatePmPlanState(messageId, (prev) => ({ ...prev, applying: false, stage: 'error', error: message }));
      addNotification({ type: 'warning', title: t('ai.pmPlan.applyFailedTitle'), message });
    }
  }, [applyPmPlanPayload, updatePmPlanState, invalidatePmQueries, addNotification, t]);

  const handlePmPlanEdit = useCallback((messageId: string, initialDraft: string) => {
    updatePmPlanState(messageId, (prev) => ({
      ...prev, isEditing: true, dismissed: false, error: null,
      draft: prev.draft || initialDraft,
    }));
  }, [updatePmPlanState]);

  const handlePmPlanDraftChange = useCallback((messageId: string, draft: string) => {
    updatePmPlanState(messageId, (prev) => ({ ...prev, draft }));
  }, [updatePmPlanState]);

  const handlePmPlanApplyChanges = useCallback(async (messageId: string, draft: string) => {
    const parsed = parsePmPlanDraft(draft);
    if (!parsed) {
      updatePmPlanState(messageId, (prev) => ({ ...prev, stage: 'error', error: t('ai.pmPlan.invalidDraft') }));
      return;
    }
    updatePmPlanState(messageId, (prev) => ({ ...prev, applying: true, stage: 'validating', error: null }));
    try {
      await new Promise((r) => setTimeout(r, 180));
      updatePmPlanState(messageId, (prev) => ({ ...prev, stage: 'persisting' }));
      const result = await applyPmPlanPayload(parsed);
      updatePmPlanState(messageId, (prev) => ({ ...prev, stage: 'refreshing' }));
      await invalidatePmQueries();
      updatePmPlanState(messageId, (prev) => ({ ...prev, applying: false, isEditing: false, stage: 'success', applied: true }));
      addNotification({
        type: 'success',
        title: t('ai.pmPlan.appliedTitle'),
        message: t('ai.pmPlan.appliedMessage', {
          milestones: String(result.milestonesCreated),
          sprints: String(result.sprintsCreated),
          issues: String(result.issuesUpdated),
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('ai.pmPlan.applyError');
      updatePmPlanState(messageId, (prev) => ({ ...prev, applying: false, stage: 'error', error: message }));
      addNotification({ type: 'warning', title: t('ai.pmPlan.applyFailedTitle'), message });
    }
  }, [applyPmPlanPayload, updatePmPlanState, invalidatePmQueries, addNotification, t]);

  const handlePmPlanCancel = useCallback((messageId: string) => {
    updatePmPlanState(messageId, (prev) => ({
      ...prev, isEditing: false, applying: false,
      stage: prev.applied ? 'success' : 'idle',
      dismissed: !prev.applied, error: null,
    }));
  }, [updatePmPlanState]);

  // ── Keyboard handler ──────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const isLoading = isStreaming || ocLoading;
  const hasMessages = aiMode === 'gemini' ? agentMessages.length > 0 : ocMessages.length > 0;
  const totalIssues = Object.values(allIssuesByProject).reduce((sum, arr) => sum + arr.length, 0);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Floating toggle button */}
      <button
        data-tour="ai-assistant"
        onClick={toggle}
        aria-label={open ? (t('ai.closeAssistant') || 'Close AI assistant') : (t('ai.openAssistant') || 'Open AI assistant')}
        aria-expanded={open}
        className={cn(
          'fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-105',
          open
            ? 'bg-surface-hover text-primary border border-border'
            : 'bg-amber-500 text-black hover:bg-amber-400',
        )}
      >
        {open ? <X size={20} aria-hidden="true" /> : <Sparkles size={20} aria-hidden="true" />}
      </button>

      {/* Panel */}
      {open && (
        <Conversation className="fixed bottom-20 right-6 z-40 flex w-[420px] max-h-[580px] flex-col overflow-hidden animate-slide-in-right">
          <ConversationHeader
            title={t('ai.title')}
            subtitle={aiMode === 'gemini'
              ? (totalIssues > 0 ? `${totalIssues} issues · ${projects.length} projects · Backend Agent` : t('ai.loading'))
              : (openclawConnected
                ? `${totalIssues} issues · ${projects.length} projects · OpenClaw`
                : t('ai.openclawNotConnected'))
            }
          />

          {/* Header + Mode Toggle */}
          <div className="flex flex-col border-b border-border shrink-0 bg-surface">
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500">
                  <Sparkles size={14} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-primary flex items-center gap-1.5">
                    {t('ai.title')}
                    {aiMode === 'gemini' && (
                      <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-1.5 py-0 text-[9px] font-medium">
                        {t('ai.skills', { count: skillCount })}
                      </span>
                    )}
                    {aiMode === 'openclaw' && (
                      <span className={cn(
                        'rounded-full px-1.5 py-0 text-[9px] font-medium flex items-center gap-0.5',
                        openclawConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400',
                      )}>
                        {openclawConnected ? <Wifi size={8} /> : <WifiOff size={8} />}
                        {openclawConnected ? t('settings.connected') : t('settings.disconnected')}
                      </span>
                    )}
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {hasMessages && (
                  <button
                    onClick={handleClearMessages}
                    className="rounded-md p-1.5 text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
                    title={t('ai.clearHistory')}
                    aria-label={t('ai.clearHistory') || 'Clear chat history'}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  aria-label={t('ai.closeAssistant') || 'Close AI assistant'}
                  className="rounded-md p-1.5 text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Mode Toggle */}
            <div className="flex px-4 pb-2 gap-1">
              <button
                onClick={() => setAiMode('gemini')}
                className={cn(
                  'flex-1 rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-colors',
                  aiMode === 'gemini' ? 'bg-accent text-black' : 'bg-surface-hover text-secondary hover:text-primary',
                )}
              >
                {t('ai.modeGemini')}
              </button>
              <button
                onClick={() => setAiMode('openclaw')}
                className={cn(
                  'flex-1 rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-colors flex items-center justify-center gap-1',
                  aiMode === 'openclaw' ? 'bg-accent text-black' : 'bg-surface-hover text-secondary hover:text-primary',
                )}
              >
                {t('ai.modeOpenClaw')}
                {openclawConnected && aiMode !== 'openclaw' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            </div>
          </div>

          {/* Messages */}
          <ConversationBody className="flex-1 overflow-y-auto min-h-0">
            {!hasMessages && !isLoading ? (
              /* Empty state + suggestions */
              <div className="flex flex-col items-center justify-center py-5 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 mb-3">
                  <Sparkles size={24} />
                </div>
                <h4 className="text-sm font-semibold text-primary mb-1">{t('ai.agentWithSkills')}</h4>
                <p className="text-xs text-muted mb-3 max-w-[280px]">{t('ai.agentDesc')}</p>

                {/* Skills list */}
                <div className="w-full mb-3 px-2">
                  <details className="group">
                    <summary className="flex items-center justify-center gap-1 cursor-pointer text-[10px] text-muted hover:text-secondary transition-colors">
                      <Wrench size={10} />
                      {t('ai.availableSkills')}
                      <ChevronDown size={10} className="group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[9px]">
                      {[
                        ['search_issues', t('ai.skillSearch')],
                        ['create_issue', t('ai.skillCreate')],
                        ['update_issue', t('ai.skillUpdate')],
                        ['bulk_update', t('ai.skillBulkUpdate')],
                        ['add_comment', t('ai.skillComment')],
                        ['plan_milestones', t('ai.skillPlanMilestones')],
                        ['generate_prd', t('ai.skillPrd')],
                        ['analyze_sprint', t('ai.skillSprint')],
                        ['get_metrics', t('ai.skillMetrics')],
                        ['adjust_timeline', t('ai.skillAdjustTimeline')],
                      ].map(([skill, label]) => (
                        <div key={skill} className="flex items-center gap-1 rounded border border-border/50 bg-surface/50 px-2 py-1">
                          <span className="text-accent">⚡</span>
                          <span className="text-secondary">{label}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>

                {/* Suggestion chips */}
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => handleSend(s.prompt)}
                      className="rounded-full border border-border bg-surface px-2.5 py-1.5 text-[10px] text-secondary hover:border-accent hover:text-accent transition-colors"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {/* Gemini mode: AgentMessage list */}
                {aiMode === 'gemini' && agentMessages.map((msg) => (
                  <AgentMessageBubble
                    key={msg.id}
                    message={msg}
                    onAction={(prompt) => handleSend(prompt)}
                    onPmPlanAccept={handlePmPlanAccept}
                    onPmPlanEdit={handlePmPlanEdit}
                    onPmPlanApplyChanges={handlePmPlanApplyChanges}
                    onPmPlanCancel={handlePmPlanCancel}
                    onPmPlanDraftChange={handlePmPlanDraftChange}
                    getPmPlanState={getPmPlanState}
                  />
                ))}

                {/* OpenClaw mode: simple message list */}
                {aiMode === 'openclaw' && ocMessages.map((msg) => (
                  <OcMessageBubble key={msg.id} message={msg} />
                ))}

                {isLoading && <TypingIndicator />}

                {/* Agent error banner */}
                {agentError && !isStreaming && aiMode === 'gemini' && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
                    {agentError}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </ConversationBody>

          {/* Suggestion chips while chatting */}
          {hasMessages && !isLoading && (
            <div className="border-t border-border px-3 py-1.5 shrink-0">
              <div className="flex gap-1 overflow-x-auto pb-0.5">
                {SUGGESTIONS.slice(0, 4).map((s) => (
                  <button
                    key={s.label}
                    onClick={() => handleSend(s.prompt)}
                    className="shrink-0 rounded-full border border-border bg-surface px-2 py-1 text-[9px] text-muted hover:border-accent hover:text-accent transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input footer */}
          <ConversationFooter>
            <div className="flex items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2 focus-within:border-accent transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('ai.placeholder')}
                aria-label={t('ai.placeholder') || 'Ask the AI assistant'}
                disabled={isLoading}
                rows={1}
                className="flex-1 bg-transparent text-sm text-primary placeholder-muted outline-none resize-none max-h-20"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                aria-label="Send message"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={14} aria-hidden="true" />
              </button>
            </div>
            <p className="text-[9px] text-muted mt-1 text-center">
              {aiMode === 'gemini'
                ? `Backend Agent · ${skillCount} skills · ${t('ai.realTimeData')}`
                : `🦞 OpenClaw · ${t('ai.realTimeData')}`
              }
            </p>
          </ConversationFooter>
        </Conversation>
      )}
    </>
  );
}
