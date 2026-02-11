import { useRef, useEffect, useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, X, Send, Trash2, Bot, User, Loader2,
  Wrench, CheckCircle2, XCircle, ChevronDown, Wifi, WifiOff,
  RefreshCw, Clock, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { useAIAssistantStore, type AIMessage } from '@/stores/ai-assistant';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { generateAIResponse, RateLimitError } from '@/lib/ai-engine';
import {
  getOpenClawConfig,
  sendToOpenClaw,
  OpenClawError,
  type OpenClawConfig,
} from '@/lib/openclaw-engine';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/shared/MarkdownView';
import type { Issue } from '@/lib/types';
import type { SkillResult } from '@/lib/ai-skills';
import { SKILL_TOOLS } from '@/lib/ai-skills';
import { type AIStateContext, createInitialState } from '@/lib/ai-state';

type AIMode = 'gemini' | 'openclaw';

function useSuggestions() {
  const { t } = useTranslation();
  return [
    { label: t('ai.suggestionSummary'), prompt: t('ai.suggestionSummaryPrompt') },
    { label: t('ai.suggestionTodo'), prompt: t('ai.suggestionTodoPrompt') },
    { label: t('ai.suggestionBlockers'), prompt: t('ai.suggestionBlockersPrompt') },
    { label: t('ai.suggestionReprioritize'), prompt: t('ai.suggestionReprioritizePrompt') },
    { label: t('ai.suggestionRecap'), prompt: t('ai.suggestionRecapPrompt') },
    { label: t('ai.suggestionCreate'), prompt: t('ai.suggestionCreatePrompt') },
  ];
}

// ─── Enhanced Skill Result with execution time ─
interface EnhancedSkillResult extends SkillResult {
  executionTimeMs?: number;
}

// ─── Enhanced Skill Badge ─────────────────────
function SkillBadge({ result }: { result: EnhancedSkillResult }) {
  const [expanded, setExpanded] = useState(false);

  const icon = result.success ? (
    <CheckCircle2 size={11} className="text-emerald-400" />
  ) : (
    <XCircle size={11} className="text-red-400" />
  );

  return (
    <div className="flex flex-col">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 rounded-md border border-border/60 bg-surface-hover/50 px-2 py-1 text-[10px] hover:bg-surface-hover transition-colors cursor-pointer"
      >
        <Wrench size={10} className="text-accent shrink-0" />
        <span className="text-muted font-mono">{result.skill}</span>
        {icon}
        {result.executionTimeMs !== undefined && (
          <span className="flex items-center gap-0.5 text-muted/60">
            <Clock size={8} />
            {result.executionTimeMs}ms
          </span>
        )}
        <span className="text-secondary">{result.summary}</span>
        <ChevronDown size={8} className={cn('text-muted transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && result.data && (
        <div className="mt-1 rounded-md border border-border/40 bg-surface/80 px-2 py-1.5 text-[9px] font-mono text-muted overflow-x-auto max-h-32 overflow-y-auto">
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(result.data, null, 2).substring(0, 1000)}
            {JSON.stringify(result.data, null, 2).length > 1000 && '\n... (truncated)'}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Error Message Component ──────────────────
function ErrorMessage({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const { t } = useTranslation();

  let errorIcon = <AlertTriangle size={12} className="text-amber-400" />;
  let errorText = error;
  let retryable = true;

  if (error.includes('429') || error.includes('Rate limit')) {
    errorText = t('ai.errorRateLimit') || 'Rate limited — wait a moment and try again';
    errorIcon = <Clock size={12} className="text-amber-400" />;
  } else if (error.includes('403') || error.includes('API key')) {
    errorText = t('ai.errorApiKey') || 'API key issue — check your configuration';
    retryable = false;
  } else if (error.includes('network') || error.includes('Network') || error.includes('fetch') || error.includes('Failed to fetch')) {
    errorText = t('ai.errorNetwork') || 'Connection lost — check your internet';
    errorIcon = <WifiOff size={12} className="text-red-400" />;
  }

  return (
    <div className="flex gap-2">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-400 mt-0.5">
        <AlertTriangle size={12} />
      </div>
      <div className="space-y-1.5">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <div className="flex items-center gap-1.5 text-sm">
            {errorIcon}
            <span className="text-amber-200/90">{errorText}</span>
          </div>
        </div>
        {retryable && onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[10px] text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
          >
            <RefreshCw size={10} />
            {t('ai.retry') || 'Retry'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────
function MessageBubble({ message, onAction }: { message: AIMessage; onAction?: (prompt: string) => void }) {
  const isUser = message.role === 'user';
  const { t } = useTranslation();

  // Detect if this is an error message
  const isError = !isUser && message.content.startsWith('⚠️');

  // Detect if this message contains a milestone plan proposal (plan_milestones was executed)
  const hasPlanProposal = !isUser && message.skills?.some((s) => s.skill === 'plan_milestones' && s.success);
  // Detect if milestones were created
  const hasCreatedMilestones = !isUser && message.skills?.some((s) => s.skill === 'create_milestones_batch' && s.success);

  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full mt-0.5',
          isUser ? 'bg-accent/20 text-accent' : 'bg-surface-hover text-secondary',
        )}
      >
        {isUser ? <User size={12} /> : <Bot size={12} />}
      </div>
      <div className={cn('max-w-[88%] space-y-1.5')}>
        {/* Skills executed */}
        {message.skills && message.skills.length > 0 && (
          <div className="flex flex-col gap-1">
            {message.skills.map((s, i) => (
              <SkillBadge key={i} result={s as EnhancedSkillResult} />
            ))}
          </div>
        )}
        {/* Message content */}
        <div
          className={cn(
            'rounded-lg px-3 py-2',
            isUser ? 'bg-accent text-black' : isError ? 'bg-amber-500/5 border border-amber-500/30' : 'bg-surface border border-border',
          )}
        >
          {isUser ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="text-sm">
              <MarkdownView content={message.content} />
            </div>
          )}
        </div>

        {/* Action buttons for milestone proposals */}
        {hasPlanProposal && onAction && (() => {
          // Extract the proposed plan data from the skill result
          const planResult = message.skills?.find((s) => s.skill === 'plan_milestones' && s.success);
          const planData = planResult?.data as { project_id?: string; proposed_milestones?: Array<{ name: string; description?: string; target_date?: string; order?: number; issue_ids: string[] }> } | undefined;
          const hasProposedMilestones = planData?.proposed_milestones && planData.proposed_milestones.length > 0;

          return (
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => {
                  if (hasProposedMilestones) {
                    // Send the actual plan data so AI can call create_milestones_batch directly
                    onAction(`Yes, apply the plan now. Call create_milestones_batch with project_id="${planData!.project_id}" and these milestones: ${JSON.stringify(planData!.proposed_milestones!.map(m => ({ name: m.name, description: m.description, target_date: m.target_date, order: m.order, issue_ids: m.issue_ids })))}`);
                  } else {
                    onAction('Yes, apply this milestone plan. Create all the milestones and assign the issues as proposed.');
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 transition-colors"
              >
                <CheckCircle2 size={12} />
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

        {/* Success confirmation for created milestones */}
        {hasCreatedMilestones && (
          <div className="flex items-center gap-1.5 mt-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-3 py-1.5">
            <CheckCircle2 size={12} className="text-emerald-500" />
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{t('milestones.planApplied')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator({ skillName }: { skillName?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-secondary mt-0.5">
        <Bot size={12} />
      </div>
      <div className="rounded-lg bg-surface border border-border px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin text-accent" />
          <span className="text-xs text-muted">
            {skillName ? t('ai.executingSkill', { name: skillName }) : t('ai.analyzing')}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────
export function AIAssistant() {
  const { t } = useTranslation();
  const SUGGESTIONS = useSuggestions();
  const {
    open, messages, loading, input,
    toggle, setOpen, setInput, addMessage, setLoading, clearMessages,
  } = useAIAssistantStore();

  const [aiMode, setAiMode] = useState<AIMode>('gemini');
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const [aiStateContext, setAiStateContext] = useState<AIStateContext>(createInitialState);
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Get OpenClaw config from localStorage (per-user, via openclaw-engine)
  const [openclawConfig, setOpenclawConfig] = useState<OpenClawConfig | null>(getOpenClawConfig);
  useEffect(() => {
    setOpenclawConfig(getOpenClawConfig());
  }, [open]); // Re-check when panel opens

  // Reset state when clearing messages
  const handleClearMessages = useCallback(() => {
    clearMessages();
    setAiStateContext(createInitialState());
    setLastError(null);
    setLastFailedMessage(null);
  }, [clearMessages]);

  // Fetch all projects
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Fetch issues for each project
  const { data: allIssuesByProject = {} } = useQuery({
    queryKey: ['all-issues-for-ai', projects.map((p) => p.id).join(',')],
    queryFn: async () => {
      const result: Record<string, Issue[]> = {};
      await Promise.all(
        projects.map(async (project) => {
          try {
            const issues = await apiClient.issues.listByProject(project.id, { limit: 500 });
            result[project.id] = issues;
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

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  const openclawConnected = openclawConfig?.status === 'connected';

  const handleSendOpenClaw = useCallback(
    async (msg: string) => {
      if (!openclawConfig || !openclawConnected) {
        addMessage('assistant', `⚠️ ${t('ai.openclawNotConnected')}`);
        setLoading(false);
        return;
      }

      try {
        // Build org context to inject
        const contextParts: string[] = [];
        contextParts.push(`[Baaton Board Context — ${projects.length} projects]`);
        for (const p of projects) {
          const issues = allIssuesByProject[p.id] ?? [];
          const byStatus: Record<string, number> = {};
          for (const issue of issues) {
            byStatus[issue.status] = (byStatus[issue.status] || 0) + 1;
          }
          const statusSummary = Object.entries(byStatus)
            .map(([s, c]) => `${s}: ${c}`)
            .join(', ');
          contextParts.push(`- ${p.name} (${p.prefix}): ${issues.length} issues [${statusSummary}]`);
        }
        const context = contextParts.join('\n');

        // Use openclaw-engine with session isolation
        const response = await sendToOpenClaw(msg, openclawConfig, {
          context,
        });
        addMessage('assistant', response.text);
      } catch (err) {
        console.error('OpenClaw error:', err);
        const errorMsg = err instanceof OpenClawError
          ? (err.isConnectionError ? t('ai.openclawConnectionError') : err.message)
          : (err instanceof Error ? err.message : t('ai.errorGeneric'));
        addMessage('assistant', `⚠️ ${t('ai.error', { message: errorMsg })}`);
      }
    },
    [openclawConfig, openclawConnected, projects, allIssuesByProject, addMessage, t],
  );

  const handleSend = useCallback(
    async (text?: string) => {
      const msg = (text ?? input).trim();
      if (!msg || loading) return;

      setInput('');
      setLastError(null);
      setLastFailedMessage(null);
      addMessage('user', msg);
      setLoading(true);

      if (aiMode === 'openclaw') {
        await handleSendOpenClaw(msg);
        setLoading(false);
        return;
      }

      try {
        const history = messages.map((m) => ({ role: m.role, content: m.content }));

        const token = await getToken();
        const response = await generateAIResponse(
          msg,
          projects,
          allIssuesByProject,
          history,
          apiClient as unknown as Parameters<typeof generateAIResponse>[4],
          aiStateContext,
          token || undefined,
        );

        // Update state context for next turn
        setAiStateContext(response.stateContext);

        addMessage('assistant', response.text, response.skillsExecuted);

        // If skills created/updated issues, invalidate queries to refresh the board
        if (response.skillsExecuted.some((s) =>
          s.success && ['create_issue', 'update_issue', 'bulk_update_issues', 'create_milestones_batch'].includes(s.skill),
        )) {
          queryClient.invalidateQueries({ queryKey: ['issues'] });
          queryClient.invalidateQueries({ queryKey: ['all-issues'] });
          queryClient.invalidateQueries({ queryKey: ['my-issues'] });
          queryClient.invalidateQueries({ queryKey: ['milestones'] });
        }
      } catch (err) {
        console.error('AI error:', err);

        // ── Error Boundary: categorize and show user-friendly messages ──
        const errorMsg = err instanceof Error ? err.message : String(err);

        if (err instanceof RateLimitError) {
          setLastError('Rate limit exceeded');
          setLastFailedMessage(msg);
          addMessage('assistant', `⚠️ ${t('ai.errorRateLimit') || 'Rate limited — wait a moment and try again'}`);
        } else if (errorMsg.includes('429')) {
          setLastError('429');
          setLastFailedMessage(msg);
          addMessage('assistant', `⚠️ ${t('ai.errorRateLimit') || 'Rate limited — wait a moment and try again'}`);
        } else if (errorMsg.includes('403')) {
          setLastError('403');
          addMessage('assistant', `⚠️ ${t('ai.errorApiKey') || 'API key issue — check your configuration'}`);
        } else if (errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('Network')) {
          setLastError('network');
          setLastFailedMessage(msg);
          addMessage('assistant', `⚠️ ${t('ai.errorNetwork') || 'Connection lost — check your internet'}`);
        } else {
          const safeMessage = t('ai.errorGeneric') || 'AI request failed. Please try again.';
          setLastError(safeMessage);
          setLastFailedMessage(msg);
          addMessage('assistant', `⚠️ ${safeMessage}`);
        }
      } finally {
        setLoading(false);
      }
    },
    [input, loading, messages, projects, allIssuesByProject, apiClient, setInput, addMessage, setLoading, queryClient, aiMode, handleSendOpenClaw, aiStateContext, t],
  );

  const handleRetry = useCallback(() => {
    if (lastFailedMessage) {
      setLastError(null);
      handleSend(lastFailedMessage);
    }
  }, [lastFailedMessage, handleSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const totalIssues = Object.values(allIssuesByProject).reduce((sum, arr) => sum + arr.length, 0);
  const skillCount = SUGGESTIONS.length;

  return (
    <>
      {/* Floating Button */}
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
        <div
          role="dialog"
          aria-modal="false"
          aria-label={t('ai.title') || 'AI Assistant'}
          className="fixed bottom-20 right-6 z-40 flex w-[420px] max-h-[580px] flex-col rounded-xl border border-border bg-bg shadow-2xl overflow-hidden animate-slide-in-right"
          style={{ maxHeight: 'min(580px, calc(100vh - 120px))' }}
        >
          {/* Header */}
          <div className="flex flex-col border-b border-border shrink-0 bg-surface">
            <div className="flex items-center justify-between px-4 py-3">
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
                        openclawConnected
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-red-500/20 text-red-400',
                      )}>
                        {openclawConnected ? <Wifi size={8} /> : <WifiOff size={8} />}
                        {openclawConnected ? t('settings.connected') : t('settings.disconnected')}
                      </span>
                    )}
                  </h3>
                  <p className="text-[9px] text-muted">
                    {aiMode === 'gemini'
                      ? (totalIssues > 0 ? `${totalIssues} issues · ${projects.length} projects · Gemini Flash` : t('ai.loading'))
                      : (openclawConnected
                          ? `${totalIssues} issues · ${projects.length} projects · OpenClaw`
                          : t('ai.openclawNotConnected')
                        )
                    }
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
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
                  aiMode === 'gemini'
                    ? 'bg-accent text-black'
                    : 'bg-surface-hover text-secondary hover:text-primary',
                )}
              >
                {t('ai.modeGemini')}
              </button>
              <button
                onClick={() => setAiMode('openclaw')}
                className={cn(
                  'flex-1 rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-colors flex items-center justify-center gap-1',
                  aiMode === 'openclaw'
                    ? 'bg-accent text-black'
                    : 'bg-surface-hover text-secondary hover:text-primary',
                )}
              >
                {t('ai.modeOpenclaw')}
                {openclawConnected && aiMode !== 'openclaw' && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {messages.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center py-5 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 mb-3">
                  <Sparkles size={24} />
                </div>
                <h4 className="text-sm font-semibold text-primary mb-1">{t('ai.agentWithSkills')}</h4>
                <p className="text-xs text-muted mb-3 max-w-[280px]">
                  {t('ai.agentDesc')}
                </p>

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

                {/* Suggestions */}
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
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} onAction={(prompt) => handleSend(prompt)} />
                ))}
                {loading && <TypingIndicator />}
                {/* Retry button on error */}
                {lastError && !loading && lastFailedMessage && (
                  <ErrorMessage error={lastError} onRetry={handleRetry} />
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Suggestion chips when chatting */}
          {messages.length > 0 && !loading && (
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

          {/* Input */}
          <div className="border-t border-border px-3 py-2.5 shrink-0">
            <div className="flex items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2 focus-within:border-accent transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('ai.placeholder')}
                aria-label={t('ai.placeholder') || 'Ask the AI assistant'}
                disabled={loading}
                rows={1}
                className="flex-1 bg-transparent text-sm text-primary placeholder-muted outline-none resize-none max-h-20"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || loading}
                aria-label="Send message"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={14} aria-hidden="true" />
              </button>
            </div>
            <p className="text-[9px] text-muted mt-1 text-center">
              {aiMode === 'gemini'
                ? `Gemini Flash · ${SKILL_TOOLS[0].functionDeclarations.length} skills · ${t('ai.realTimeData')} · 📎 ${t('ai.imagesHint')}`
                : `🦞 OpenClaw · ${t('ai.realTimeData')}`
              }
            </p>
          </div>
        </div>
      )}
    </>
  );
}
