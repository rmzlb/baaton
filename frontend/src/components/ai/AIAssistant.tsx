/**
 * AIAssistant — Right sidebar AI panel using AI Elements SDK.
 *
 * Same rendering quality as /ai (AIChat) but in a sidebar form factor.
 * Uses: Conversation, Message, MessageResponse, PromptInput, Shimmer, Suggestions.
 */

import { useRef, useEffect, useCallback, useState, memo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, Trash2, Bot, User, Copy, Check, RefreshCw,
  Wrench, ChevronDown, Plus, MessageSquare, PanelRightClose, AlertCircle,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { useUIStore } from '@/stores/ui';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { useAgentChat, type AgentMessage } from '@/hooks/useAgentChat';
import { ToolResultRenderer } from '@/components/ai/ToolResultRenderer';
import { TOOL_SCHEMAS } from '@/lib/ai-skills';
import { cn } from '@/lib/utils';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion';

// ─── Session persistence ───────────────────────

interface StoredSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'baaton-ai-panel-sessions';
const MAX_SESSIONS = 30;

function loadSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession[]) : [];
  } catch { return []; }
}

function saveSessions(ss: StoredSession[]) {
  try {
    const trimmed = ss.slice(0, MAX_SESSIONS).map(s => ({
      ...s,
      messages: s.messages.slice(-80).map(m => ({
        ...m,
        toolCalls: m.toolCalls
          ?.filter(tc => tc.status !== 'executing')
          .map(tc => ({ ...tc, result: tc.result ? { ...tc.result, data: undefined } : undefined })),
      })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota */ }
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function makeSession(): StoredSession {
  const now = Date.now();
  return { id: uid(), title: '', messages: [], createdAt: now, updatedAt: now };
}

// ─── Session list item ─────────────────────────

const SessionItem = memo(function SessionItem({
  s, active, onSelect, onDelete,
}: {
  s: StoredSession;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onSelect}
      className={cn(
        'group flex items-center gap-2 rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors',
        active
          ? 'bg-surface-hover text-primary'
          : 'text-secondary hover:bg-surface/80 hover:text-primary',
      )}
    >
      <MessageSquare size={12} className="shrink-0 text-muted/60" />
      <span className="flex-1 text-[11px] truncate">{s.title || t('aiChat.newChat')}</span>
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="shrink-0 rounded p-0.5 text-transparent group-hover:text-muted hover:!text-red-400 transition-colors"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
});

// ─── Copy button ───────────────────────────────

function CopyButton({ content }: { content: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <MessageAction tooltip={copied ? t('aiChat.copied') : t('aiChat.copy')} onClick={handleCopy}>
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </MessageAction>
  );
}

// ─── Message bubble (AI Elements SDK) ──────────

const PanelMessageBubble = memo(function PanelMessageBubble({
  msg, isLast, isStreaming, onRegenerate,
}: {
  msg: AgentMessage;
  isLast: boolean;
  isStreaming: boolean;
  onRegenerate?: () => void;
}) {
  const { t } = useTranslation();

  const isThinking =
    msg.role === 'assistant' &&
    isLast &&
    isStreaming &&
    !msg.content &&
    !msg.toolCalls?.length;

  return (
    <Message from={msg.role}>
      <MessageContent>
        {isThinking ? (
          <div className="flex items-center gap-2 py-1">
            <Bot size={14} className="text-accent shrink-0" />
            <Shimmer className="text-sm text-muted/70">{t('aiChat.thinking')}</Shimmer>
          </div>
        ) : (
          <>
            {msg.toolCalls?.map(tc => (
              <ToolResultRenderer key={tc.id} event={tc} />
            ))}

            {msg.content && (
              msg.role === 'user' ? (
                <div className="flex items-start gap-2">
                  <User size={14} className="text-secondary mt-0.5 shrink-0" />
                  <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                </div>
              ) : (
                <MessageResponse isAnimating={isLast && isStreaming}>
                  {msg.content}
                </MessageResponse>
              )
            )}
          </>
        )}
      </MessageContent>

      {!isThinking && msg.content && (
        <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity">
          <CopyButton content={msg.content} />
          {msg.role === 'assistant' && isLast && !isStreaming && onRegenerate && (
            <MessageAction tooltip={t('aiChat.regenerate')} onClick={onRegenerate}>
              <RefreshCw size={12} />
            </MessageAction>
          )}
        </MessageActions>
      )}
    </Message>
  );
});

// ─── Suggestions ───────────────────────────────

function useSuggestions() {
  const { t } = useTranslation();
  return [
    { label: t('ai.suggestionSummary'), prompt: t('ai.suggestionSummaryPrompt') },
    { label: t('ai.suggestionTriage'), prompt: t('ai.suggestionTriagePrompt') },
    { label: t('ai.suggestionCreate'), prompt: t('ai.suggestionCreatePrompt') },
    { label: t('ai.suggestionSprint'), prompt: t('ai.suggestionSprintPrompt') },
    { label: t('ai.suggestionRecap'), prompt: t('ai.suggestionRecapPrompt') },
  ];
}

// ─── Main Component ────────────────────────────

export function AIAssistant() {
  const { t } = useTranslation();
  const PANEL_SUGGESTIONS = useSuggestions();
  const aiPanelOpen = useUIStore(s => s.aiPanelOpen);
  const setAiPanelOpen = useUIStore(s => s.setAiPanelOpen);
  const toggleAiPanel = useUIStore(s => s.toggleAiPanel);

  const [authToken, setAuthToken] = useState('');
  const [sessionsView, setSessionsView] = useState(false);
  const [sessions, setSessions] = useState<StoredSession[]>(loadSessions);
  const [activeId, setActiveId] = useState<string | null>(() => loadSessions()[0]?.id ?? null);

  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  // Fresh token getter for each request (no stale timer)
  const getAuthToken = useCallback(async () => {
    const tk = await getToken();
    if (tk) setAuthToken(tk);
    return tk;
  }, [getToken]);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  const {
    messages, sendMessage: agentSend, isStreaming,
    error: agentError, clearMessages, loadMessages, abort,
  } = useAgentChat({
    projectIds: projects.map(p => p.id),
    getAuthToken,
    onComplete: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['milestones'], refetchType: 'all' });
    },
  });

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  useEffect(() => {
    const initial = loadSessions().find(s => s.id === activeId);
    if (initial?.messages.length) loadMessages(initial.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prevStreamingRef = useRef(false);
  useEffect(() => {
    const justFinished = prevStreamingRef.current && !isStreaming;
    prevStreamingRef.current = isStreaming;
    if (!justFinished) return;

    const msgs = messagesRef.current;
    const sid = activeIdRef.current;
    if (!msgs.length || !sid) return;

    setSessions(prev => {
      const updated = prev.map(s => {
        if (s.id !== sid) return s;
        const title = s.title || msgs.find(m => m.role === 'user')?.content.slice(0, 40) || t('aiChat.newChat');
        return { ...s, messages: msgs, title, updatedAt: Date.now() };
      });
      saveSessions(updated);
      return updated;
    });
  }, [isStreaming, t]);

  // Cmd+J shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        toggleAiPanel();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggleAiPanel]);

  const skillCount = Object.keys(TOOL_SCHEMAS).length;

  // ── Session management ──

  const handleNewSession = useCallback(() => {
    const s = makeSession();
    setSessions(prev => {
      const updated = [s, ...prev];
      saveSessions(updated);
      return updated;
    });
    setActiveId(s.id);
    clearMessages();
    setSessionsView(false);
  }, [clearMessages]);

  const handleSwitchSession = useCallback((id: string) => {
    const s = sessions.find(ss => ss.id === id);
    setActiveId(id);
    if (s?.messages.length) loadMessages(s.messages);
    else clearMessages();
    setSessionsView(false);
  }, [sessions, loadMessages, clearMessages]);

  const handleDeleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id);
      saveSessions(updated);
      return updated;
    });
    if (activeId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      if (remaining.length > 0) {
        setActiveId(remaining[0].id);
        loadMessages(remaining[0].messages);
      } else {
        setActiveId(null);
        clearMessages();
      }
    }
  }, [activeId, sessions, loadMessages, clearMessages]);

  // ── Send ──

  const handleSend = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || isStreaming) return;

    if (!activeId) {
      const s = makeSession();
      setSessions(prev => {
        const updated = [s, ...prev];
        saveSessions(updated);
        return updated;
      });
      setActiveId(s.id);
    }

    await agentSend(msg);
  }, [isStreaming, activeId, agentSend]);

  const handleRegenerate = useCallback(() => {
    if (isStreaming || !messages.length) return;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const lastUserContent = messages[lastUserIdx].content;
    loadMessages(messages.slice(0, lastUserIdx));
    setTimeout(() => agentSend(lastUserContent), 0);
  }, [messages, isStreaming, loadMessages, agentSend]);

  const isEmpty = messages.length === 0 && !isStreaming;
  const canSend = !isStreaming;
  const chatStatus = (isStreaming ? 'streaming' : 'ready') as 'streaming' | 'ready';

  // ── FAB when closed ──

  if (!aiPanelOpen) {
    return (
      <button
        onClick={toggleAiPanel}
        aria-label={t('ai.openAssistant') || 'Open AI assistant (Cmd+J)'}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 text-black shadow-lg transition-all duration-300 hover:scale-105 hover:bg-amber-400"
      >
        <Sparkles size={20} />
      </button>
    );
  }

  return (
    <aside className="hidden lg:flex shrink-0 w-[420px] min-w-[420px] flex-col border-l border-border bg-bg h-screen">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500">
            <Sparkles size={14} />
          </div>
          <div>
            <h3 className="text-xs font-bold text-primary flex items-center gap-1.5">
              {t('ai.title')}
              <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-1.5 py-0 text-[9px] font-medium">
                {skillCount} skills
              </span>
            </h3>
            <p className="text-[10px] text-muted">
              {projects.length} {t('aiChat.projectsLabel')} · {t('aiChat.backendAgent')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSessionsView(!sessionsView)}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              sessionsView ? 'bg-surface-hover text-primary' : 'text-muted hover:text-secondary hover:bg-surface-hover',
            )}
            title="Sessions"
          >
            <MessageSquare size={14} />
          </button>
          <button
            onClick={handleNewSession}
            className="rounded-md p-1.5 text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
            title={t('aiChat.newChat')}
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setAiPanelOpen(false)}
            className="rounded-md p-1.5 text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
          >
            <PanelRightClose size={14} />
          </button>
        </div>
      </div>

      {sessionsView ? (
        /* ── Sessions list ── */
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {sessions.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted/60">{t('aiChat.noConversations')}</p>
          ) : (
            sessions.map(s => (
              <SessionItem
                key={s.id}
                s={s}
                active={s.id === activeId}
                onSelect={() => handleSwitchSession(s.id)}
                onDelete={() => handleDeleteSession(s.id)}
              />
            ))
          )}
        </div>
      ) : (
        /* ── Chat area with AI Elements SDK ── */
        <>
          <Conversation>
            <ConversationContent className="gap-4 p-3">
              {isEmpty ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-3">
                    <Sparkles size={24} className="text-accent" />
                  </div>
                  <h4 className="text-sm font-semibold text-primary mb-1">{t('ai.agentWithSkills')}</h4>
                  <p className="text-xs text-muted mb-4 max-w-[280px]">{t('ai.agentDesc')}</p>

                  <details className="w-full mb-4 px-2 group">
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
                          <span className="text-accent">*</span>
                          <span className="text-secondary">{label}</span>
                        </div>
                      ))}
                    </div>
                  </details>

                  <Suggestions>
                    {PANEL_SUGGESTIONS.map(s => (
                      <Suggestion
                        key={s.label}
                        suggestion={s.prompt}
                        onClick={handleSend}
                        disabled={!canSend}
                      >
                        {s.label}
                      </Suggestion>
                    ))}
                  </Suggestions>
                </div>
              ) : (
                <>
                  {messages.map((msg, i) => (
                    <PanelMessageBubble
                      key={msg.id}
                      msg={msg}
                      isLast={i === messages.length - 1}
                      isStreaming={isStreaming}
                      onRegenerate={
                        msg.role === 'assistant' && i === messages.length - 1
                          ? handleRegenerate
                          : undefined
                      }
                    />
                  ))}

                  {agentError && !isStreaming && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                      <AlertCircle size={14} className="text-red-400 shrink-0" />
                      <p className="text-xs text-red-300">{agentError}</p>
                    </div>
                  )}
                </>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {/* Quick suggestions while chatting */}
          {messages.length > 0 && messages.length < 4 && !isStreaming && (
            <div className="border-t border-border px-3 py-1.5 shrink-0">
              <Suggestions>
                {PANEL_SUGGESTIONS.slice(0, 4).map(s => (
                  <Suggestion
                    key={s.label}
                    suggestion={s.prompt}
                    onClick={handleSend}
                    disabled={!canSend}
                  >
                    {s.label}
                  </Suggestion>
                ))}
              </Suggestions>
            </div>
          )}

          {/* Input — AI Elements PromptInput */}
          <div className="shrink-0 border-t border-[--color-border] bg-[--color-bg] px-3 pb-4 pt-3">
            <PromptInput onSubmit={({ text }) => { if (text.trim()) void handleSend(text); }}>
              <PromptInputTextarea
                placeholder={t('ai.placeholder')}
                disabled={!canSend}
                className="text-[13px]"
              />
              <PromptInputFooter>
                <span className="text-[10px] text-[--color-muted]">
                  {t('aiChat.backendAgent')} · {skillCount} skills
                </span>
                <PromptInputSubmit
                  status={chatStatus}
                  onStop={abort}
                  disabled={!isStreaming && false}
                  className="bg-amber-500 text-black hover:bg-amber-400 rounded-lg"
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </>
      )}
    </aside>
  );
}
