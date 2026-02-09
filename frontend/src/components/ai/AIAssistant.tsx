import { useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, X, Send, Trash2, Bot, User, Loader2,
  Wrench, CheckCircle2, XCircle, ChevronDown,
} from 'lucide-react';
import { useAIAssistantStore, type AIMessage } from '@/stores/ai-assistant';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { generateAIResponse } from '@/lib/ai-engine';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/shared/MarkdownView';
import type { Issue } from '@/lib/types';
import type { SkillResult} from '@/lib/ai-skills';
import { SKILL_TOOLS } from '@/lib/ai-skills';

function useSuggestions() {
  const { t } = useTranslation();
  return [
    { label: t('ai.suggestionSummary'), prompt: t('ai.suggestionSummaryPrompt') },
    { label: t('ai.suggestionTodo'), prompt: t('ai.suggestionTodoPrompt') },
    { label: t('ai.suggestionBlockers'), prompt: t('ai.suggestionBlockersPrompt') },
    { label: t('ai.suggestionReprioritize'), prompt: t('ai.suggestionReprioritizePrompt') },
    { label: t('ai.suggestionSprint'), prompt: t('ai.suggestionSprintPrompt') },
    { label: t('ai.suggestionPrd'), prompt: t('ai.suggestionPrdPrompt') },
  ];
}

// ─── Skill Badge ──────────────────────────────
function SkillBadge({ result }: { result: SkillResult }) {
  const icon = result.success ? (
    <CheckCircle2 size={11} className="text-emerald-400" />
  ) : (
    <XCircle size={11} className="text-red-400" />
  );

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-surface-hover/50 px-2 py-1 text-[10px]">
      <Wrench size={10} className="text-accent shrink-0" />
      <span className="text-muted font-mono">{result.skill}</span>
      {icon}
      <span className="text-secondary">{result.summary}</span>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────
function MessageBubble({ message }: { message: AIMessage }) {
  const isUser = message.role === 'user';

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
          <div className="flex flex-wrap gap-1">
            {message.skills.map((s, i) => (
              <SkillBadge key={i} result={s} />
            ))}
          </div>
        )}
        {/* Message content */}
        <div
          className={cn(
            'rounded-lg px-3 py-2',
            isUser ? 'bg-accent text-black' : 'bg-surface border border-border',
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

  const apiClient = useApi();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSend = useCallback(
    async (text?: string) => {
      const msg = (text ?? input).trim();
      if (!msg || loading) return;

      setInput('');
      addMessage('user', msg);
      setLoading(true);

      try {
        const history = messages.map((m) => ({ role: m.role, content: m.content }));

        const response = await generateAIResponse(
          msg,
          projects,
          allIssuesByProject,
          history,
          apiClient as unknown as Parameters<typeof generateAIResponse>[4],
        );

        addMessage('assistant', response.text, response.skillsExecuted);

        // If skills created/updated issues, invalidate queries to refresh the board
        if (response.skillsExecuted.some((s) =>
          s.success && ['create_issue', 'update_issue', 'bulk_update_issues'].includes(s.skill),
        )) {
          queryClient.invalidateQueries({ queryKey: ['issues'] });
          queryClient.invalidateQueries({ queryKey: ['all-issues'] });
          queryClient.invalidateQueries({ queryKey: ['my-issues'] });
        }
      } catch (err) {
        console.error('AI error:', err);
        addMessage(
          'assistant',
          `⚠️ ${t('ai.error', { message: err instanceof Error ? err.message : t('ai.errorGeneric') })}`,
        );
      } finally {
        setLoading(false);
      }
    },
    [input, loading, messages, projects, allIssuesByProject, apiClient, setInput, addMessage, setLoading, queryClient],
  );

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
        onClick={toggle}
        className={cn(
          'fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-105',
          open
            ? 'bg-surface-hover text-primary border border-border'
            : 'bg-amber-500 text-black hover:bg-amber-400',
        )}
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-20 right-6 z-40 flex w-[420px] max-h-[580px] flex-col rounded-xl border border-border bg-bg shadow-2xl overflow-hidden animate-slide-in-right"
          style={{ maxHeight: 'min(580px, calc(100vh - 120px))' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0 bg-surface">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500">
                <Sparkles size={14} />
              </div>
              <div>
                <h3 className="text-xs font-bold text-primary flex items-center gap-1.5">
                  {t('ai.title')}
                  <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-1.5 py-0 text-[9px] font-medium">
                    {t('ai.skills', { count: skillCount })}
                  </span>
                </h3>
                <p className="text-[9px] text-muted">
                  {totalIssues > 0 ? `${totalIssues} issues · ${projects.length} projects · Gemini Flash` : t('ai.loading')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={clearMessages}
                  className="rounded-md p-1.5 text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
                  title={t('ai.clearHistory')}
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
              >
                <X size={14} />
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
                        ['generate_prd', t('ai.skillPrd')],
                        ['analyze_sprint', t('ai.skillSprint')],
                        ['get_metrics', t('ai.skillMetrics')],
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
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {loading && <TypingIndicator />}
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
                disabled={loading}
                rows={1}
                className="flex-1 bg-transparent text-sm text-primary placeholder-muted outline-none resize-none max-h-20"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || loading}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={14} />
              </button>
            </div>
            <p className="text-[9px] text-muted mt-1 text-center">
              Gemini Flash · {SKILL_TOOLS[0].functionDeclarations.length} skills · {t('ai.realTimeData')}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
