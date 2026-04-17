/**
 * AIChat — Full-page AI Chat backed by the server-side agent.
 *
 * Architecture:
 * - useAgentChat handles SSE streaming via POST /api/v1/ai/agent
 * - Conversations persisted in localStorage (sidebar pattern)
 * - AI Elements used for message/input rendering
 * - ToolResultRenderer for collapsible tool call cards
 */

import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import {
  Bot, Copy, Check, RefreshCw, Plus, Trash2, Sparkles,
  MessageSquare, PanelLeftClose, PanelLeft, AlertCircle, User,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { useAgentChat } from '@/hooks/useAgentChat';
import type { AgentMessage } from '@/hooks/useAgentChat';
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
import { ToolResultRenderer } from '@/components/ai/ToolResultRenderer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoredConversation {
  id: string;
  title: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'baaton-ai-chats';
const MAX_CONVOS = 50;

function loadConvos(): StoredConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredConversation[]) : [];
  } catch {
    return [];
  }
}

function saveConvos(cs: StoredConversation[]) {
  try {
    const trimmed = cs.slice(0, MAX_CONVOS).map(c => ({
      ...c,
      // Keep last 100 messages; strip executing tool calls and large data
      messages: c.messages.slice(-100).map(m => ({
        ...m,
        toolCalls: m.toolCalls
          ?.filter(tc => tc.status !== 'executing')
          .map(tc => ({
            ...tc,
            result: tc.result ? { ...tc.result, data: undefined } : undefined,
          })),
      })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // quota exceeded — silently ignore
  }
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function makeConvo(): StoredConversation {
  const now = Date.now();
  return { id: uid(), title: '', messages: [], createdAt: now, updatedAt: now };
}

// ─── Static suggestions ───────────────────────────────────────────────────────

function useChatSuggestions() {
  const { t } = useTranslation();
  return [
    { label: t('aiChat.suggestionSprint'), prompt: t('aiChat.suggestionSprintPrompt') },
    { label: t('aiChat.suggestionBugs'), prompt: t('aiChat.suggestionBugsPrompt') },
    { label: t('aiChat.suggestionRecap'), prompt: t('aiChat.suggestionRecapPrompt') },
    { label: t('aiChat.suggestionPriorities'), prompt: t('aiChat.suggestionPrioritiesPrompt') },
  ];
}

// ─── ConvoItem ────────────────────────────────────────────────────────────────

const ConvoItem = memo(function ConvoItem({
  c, active, onSelect, onDelete,
}: {
  c: StoredConversation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onSelect}
      className={cn(
        'group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors',
        active
          ? 'bg-surface-hover text-primary'
          : 'text-secondary hover:bg-surface/80 hover:text-primary',
      )}
    >
      <MessageSquare size={13} className="shrink-0 text-muted/60" />
      <span className="flex-1 text-xs truncate">{c.title || t('aiChat.newChat')}</span>
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="shrink-0 rounded p-0.5 text-transparent group-hover:text-muted hover:!text-red-400 transition-colors"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
});

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ content }: { content: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <MessageAction
      tooltip={copied ? t('aiChat.copied') : t('aiChat.copy')}
      onClick={handleCopy}
    >
      {copied
        ? <Check size={12} className="text-emerald-400" />
        : <Copy size={12} />
      }
    </MessageAction>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({
  msg, isLast, isStreaming, onRegenerate, onAction,
}: {
  msg: AgentMessage;
  isLast: boolean;
  isStreaming: boolean;
  onRegenerate?: () => void;
  onAction?: (prompt: string) => void;
}) {
  const { t } = useTranslation();

  // Show shimmer while the assistant message slot is empty and we're streaming
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
            {/* Tool calls — rendered before text */}
            {msg.toolCalls?.map(tc => (
              <ToolResultRenderer key={tc.id} event={tc} onAction={onAction} />
            ))}

            {/* Text content */}
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

      {/* Actions — only once the bubble has content */}
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AIChat() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const apiClient = useApi();
  const SUGGESTIONS = useChatSuggestions();

  // ── Auth token ──
  const getAuthToken = useCallback(async () => {
    const tk = await getToken();
    return tk;
  }, [getToken]);

  // ── Data ──
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // ── Conversation sidebar state ──
  const [convos, setConvos] = useState<StoredConversation[]>(loadConvos);
  const [activeId, setActiveId] = useState<string | null>(
    () => loadConvos()[0]?.id ?? null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Agent hook ──
  const {
    messages,
    sendMessage,
    isStreaming,
    error,
    clearMessages,
    loadMessages,
    abort,
  } = useAgentChat({
    projectIds: projects.map(p => p.id),
    getAuthToken,
  });

  // Refs for stable access inside effects
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // ── Init: restore active conversation on mount ──
  useEffect(() => {
    const initial = loadConvos().find(c => c.id === activeId);
    if (initial?.messages.length) loadMessages(initial.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once

  // ── Sync to localStorage when streaming ends ──
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    const justFinished = prevStreamingRef.current && !isStreaming;
    prevStreamingRef.current = isStreaming;

    if (!justFinished) return;

    const msgs = messagesRef.current;
    const cid = activeIdRef.current;
    if (!msgs.length || !cid) return;

    setConvos(prev => {
      const updated = prev.map(c => {
        if (c.id !== cid) return c;
        const title =
          c.title ||
          msgs.find(m => m.role === 'user')?.content.slice(0, 50) ||
          t('aiChat.newChat');
        const stored = msgs.map(m => ({
          ...m,
          toolCalls: m.toolCalls?.filter(tc => tc.status !== 'executing'),
        }));
        return { ...c, messages: stored, title, updatedAt: Date.now() };
      });
      saveConvos(updated);
      return updated;
    });
  }, [isStreaming]);

  // ── Handlers ──

  const handleNewChat = useCallback(() => {
    const c = makeConvo();
    setConvos(prev => {
      const updated = [c, ...prev];
      saveConvos(updated);
      return updated;
    });
    setActiveId(c.id);
    clearMessages();
  }, [clearMessages]);

  const handleSwitchConvo = useCallback((id: string) => {
    const c = convos.find(cv => cv.id === id);
    setActiveId(id);
    if (c?.messages.length) {
      loadMessages(c.messages);
    } else {
      clearMessages();
    }
  }, [convos, loadMessages, clearMessages]);

  const handleDeleteConvo = useCallback((id: string) => {
    setConvos(prev => {
      const updated = prev.filter(c => c.id !== id);
      saveConvos(updated);
      return updated;
    });
    if (activeId === id) {
      const remaining = convos.filter(c => c.id !== id);
      if (remaining.length > 0) {
        setActiveId(remaining[0].id);
        loadMessages(remaining[0].messages);
      } else {
        setActiveId(null);
        clearMessages();
      }
    }
  }, [activeId, convos, loadMessages, clearMessages]);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    // Ensure an active conversation exists
    if (!activeId) {
      const c = makeConvo();
      setConvos(prev => {
        const updated = [c, ...prev];
        saveConvos(updated);
        return updated;
      });
      setActiveId(c.id);
    }

    await sendMessage(text);
  }, [activeId, isStreaming, sendMessage]);

  const handleRegenerate = useCallback(() => {
    if (isStreaming || !messages.length) return;

    // Find the last user message
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;

    const lastUserContent = messages[lastUserIdx].content;
    // Restore context up to (but not including) the last user message, then resend
    loadMessages(messages.slice(0, lastUserIdx));
    // Defer to let React flush the state update before sendMessage captures history
    setTimeout(() => sendMessage(lastUserContent), 0);
  }, [messages, isStreaming, loadMessages, sendMessage]);

  // ── Derived ──
  const activeConvo = convos.find(c => c.id === activeId);
  const isEmpty = messages.length === 0 && !isStreaming;
  const canSend = !isStreaming;
  // ChatStatus type from 'ai' — we only use 'ready' | 'streaming' here
  const chatStatus = (isStreaming ? 'streaming' : 'ready') as 'streaming' | 'ready';

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className={cn(
        'flex flex-col border-r border-border bg-bg transition-all duration-200 shrink-0',
        sidebarOpen ? 'w-60' : 'w-0 border-r-0',
        sidebarOpen && 'max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:w-64 max-md:shadow-xl',
      )}>
        <div className={cn('flex flex-col h-full', !sidebarOpen && 'hidden')}>
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-3 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-accent" />
              <span className="text-sm font-semibold text-primary">{t('aiChat.title')}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleNewChat}
                title={t('aiChat.newChat')}
                className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-secondary transition-colors"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-secondary transition-colors md:hidden"
              >
                <PanelLeftClose size={14} />
              </button>
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {convos.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted/60">
                {t('aiChat.noConversations')}
              </p>
            ) : (
              convos.map(c => (
                <ConvoItem
                  key={c.id}
                  c={c}
                  active={c.id === activeId}
                  onSelect={() => handleSwitchConvo(c.id)}
                  onDelete={() => handleDeleteConvo(c.id)}
                />
              ))
            )}
          </div>

          {/* Context panel */}
          <div className="border-t border-border p-3 space-y-1.5 shrink-0">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-muted/50 mb-1.5">
              {t('aiChat.context')}
            </div>
            {[
              [t('aiChat.model'), t('aiChat.backendAgent')],
              [t('aiChat.projectsLabel'), `${projects.length}`],
            ].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between text-xs">
                <span className="text-muted/60">{label}</span>
                <span className="font-mono text-secondary">{val}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-10 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── Main area ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-hover transition-colors"
            >
              <PanelLeft size={15} />
            </button>
          )}
          <span className="text-sm font-medium text-primary truncate flex-1">
            {activeConvo?.title || t('aiChat.newChat')}
          </span>
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-secondary transition-colors"
          >
            <Plus size={13} />
            <span className="hidden sm:inline">{t('aiChat.newChat')}</span>
          </button>
        </div>

        {/* Messages — StickToBottom auto-scrolls */}
        <Conversation>
          <ConversationContent>
            {isEmpty ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center min-h-[50vh] px-6">
                <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-5">
                  <Sparkles size={32} className="text-accent" />
                </div>
                <h2 className="text-xl font-semibold text-primary mb-2">
                  {t('aiChat.emptyTitle')}
                </h2>
                <p className="text-sm text-muted mb-8 max-w-md text-center leading-relaxed">
                  {t('aiChat.emptyDesc')}
                </p>
                <Suggestions>
                  {SUGGESTIONS.map(s => (
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
              /* Message list */
              messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isLast={i === messages.length - 1}
                  isStreaming={isStreaming}
                  onAction={handleSend}
                  onRegenerate={
                    msg.role === 'assistant' && i === messages.length - 1
                      ? handleRegenerate
                      : undefined
                  }
                />
              ))
            )}

            {/* Error banner */}
            {error && !isStreaming && (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
                <AlertCircle size={14} className="text-red-400 shrink-0" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}
          </ConversationContent>

          {/* Floating scroll-to-bottom button */}
          <ConversationScrollButton />
        </Conversation>

        {/* Input area */}
        <div className="shrink-0 border-t border-border bg-bg px-4 pb-4 pt-3 space-y-2">
          {/* Quick suggestions for early conversations */}
          {messages.length > 0 && messages.length < 3 && !isStreaming && (
            <Suggestions>
              {SUGGESTIONS.map(s => (
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
          )}

          <PromptInput onSubmit={({ text }) => { if (text.trim()) void handleSend(text); }}>
            <PromptInputTextarea
              placeholder={t('ai.placeholder')}
              disabled={!canSend}
              className="text-[13px]"
            />
            <PromptInputFooter>
              <span className="text-[10px] text-[--color-muted]">
                {t('aiChat.backendAgent')} · {projects.length} {t('aiChat.projectsLabel')}
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
      </div>
    </div>
  );
}
