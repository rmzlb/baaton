/**
 * AIAssistant — Right sidebar AI panel (replaces floating popup).
 *
 * Pattern: 3-column layout integration (left nav | content | AI panel).
 * Sessions persisted in localStorage, AI Elements SDK for rendering.
 */

import { useRef, useEffect, useCallback, useState, memo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, Send, Trash2, Bot, User, Loader2,
  Wrench, ChevronDown, Plus,
  MessageSquare, PanelRightClose,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { useUIStore } from '@/stores/ui';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { useAgentChat, type AgentMessage } from '@/hooks/useAgentChat';
import { ToolResultRenderer } from '@/components/ai/ToolResultRenderer';
import { MarkdownView } from '@/components/shared/MarkdownView';
import { TOOL_SCHEMAS } from '@/lib/ai-skills';
import { cn } from '@/lib/utils';

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
      <span className="flex-1 text-[11px] truncate">{s.title || 'New Chat'}</span>
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="shrink-0 rounded p-0.5 text-transparent group-hover:text-muted hover:!text-red-400 transition-colors"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
});

// ─── Typing indicator ──────────────────────────

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

// ─── Message bubble ────────────────────────────

const MessageBubble = memo(function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user';
  const toolCalls = !isUser ? (message.toolCalls ?? []) : [];

  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      <div className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full mt-0.5',
        isUser ? 'bg-accent/20 text-accent' : 'bg-surface-hover text-secondary',
      )}>
        {isUser ? <User size={12} /> : <Bot size={12} />}
      </div>
      <div className="max-w-[88%] space-y-1.5">
        {toolCalls.length > 0 && (
          <div className="space-y-1">
            {toolCalls.map(tc => <ToolResultRenderer key={tc.id} event={tc} />)}
          </div>
        )}
        {message.content && (
          <div className={cn(
            'rounded-lg px-3 py-2',
            isUser ? 'bg-accent text-black' : 'bg-surface border border-border',
          )}>
            {isUser ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="text-sm"><MarkdownView content={message.content} /></div>
            )}
          </div>
        )}
      </div>
    </div>
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
  const SUGGESTIONS = useSuggestions();
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');

  // Auth token
  useEffect(() => {
    getToken().then(tk => { if (tk) setAuthToken(tk); });
    const id = setInterval(() => {
      getToken().then(tk => { if (tk) setAuthToken(tk); });
    }, 50 * 60 * 1000);
    return () => clearInterval(id);
  }, [getToken]);

  // Projects
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Agent chat hook
  const {
    messages, sendMessage: agentSend, isStreaming,
    error: agentError, clearMessages, loadMessages,
  } = useAgentChat({
    projectIds: projects.map(p => p.id),
    authToken,
    onComplete: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['milestones'], refetchType: 'all' });
    },
  });

  // Refs for stable access
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // Restore active session on mount
  useEffect(() => {
    const initial = loadSessions().find(s => s.id === activeId);
    if (initial?.messages.length) loadMessages(initial.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist when streaming ends
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
        const title = s.title || msgs.find(m => m.role === 'user')?.content.slice(0, 40) || 'New Chat';
        return { ...s, messages: msgs, title, updatedAt: Date.now() };
      });
      saveSessions(updated);
      return updated;
    });
  }, [isStreaming]);

  // Scroll + focus
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (aiPanelOpen) setTimeout(() => inputRef.current?.focus(), 200);
  }, [aiPanelOpen]);

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

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isStreaming) return;
    setInput('');

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
  }, [input, isStreaming, activeId, agentSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasMessages = messages.length > 0;

  if (!aiPanelOpen) return null;

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
              {projects.length} projects · Backend Agent
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
            title="New chat"
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
            <p className="px-3 py-8 text-center text-xs text-muted/60">No sessions yet</p>
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
        /* ── Chat area ── */
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {!hasMessages && !isStreaming ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 mb-3">
                  <Sparkles size={24} />
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

                <div className="flex flex-wrap gap-1.5 justify-center">
                  {SUGGESTIONS.map(s => (
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
                {messages.map(msg => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {isStreaming && <TypingIndicator />}
                {agentError && !isStreaming && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
                    {agentError}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Quick suggestions while chatting */}
          {hasMessages && !isStreaming && (
            <div className="border-t border-border px-3 py-1.5 shrink-0">
              <div className="flex gap-1 overflow-x-auto pb-0.5">
                {SUGGESTIONS.slice(0, 4).map(s => (
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
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('ai.placeholder')}
                disabled={isStreaming}
                rows={1}
                className="flex-1 bg-transparent text-sm text-primary placeholder-muted outline-none resize-none max-h-20"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isStreaming}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={14} />
              </button>
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-[9px] text-muted">
                Backend Agent · {skillCount} skills · {t('ai.realTimeData')}
              </p>
              <kbd className="text-[9px] text-muted/50 font-mono">
                {navigator.platform?.includes('Mac') ? 'Cmd' : 'Ctrl'}+J
              </kbd>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
