/**
 * AIChat — Full-page AI Chat backed by the server-side agent.
 *
 * Architecture:
 * - useChat (AI SDK) with DefaultChatTransport → POST /api/v1/ai/chat
 * - Conversations persisted in localStorage (sidebar pattern)
 * - AI Elements used for message/input rendering
 * - ToolPartRenderer routes tool-* parts to React components
 */

import { useState, useCallback, useEffect, useRef, useMemo, memo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import type { UIMessage } from 'ai';
import {
  Bot, Copy, Check, RefreshCw, Plus, Trash2, Sparkles,
  MessageSquare, PanelLeftClose, PanelLeft, AlertCircle,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { useNotificationStore } from '@/stores/notifications';
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
import { ToolPartRenderer } from '@/components/ai/ToolPartRenderer';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getTextFromMessage(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('');
}

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoredConversation {
  schema_version: 2;
  id: string;
  title: string;
  messages: UIMessage[];
  createdAt: number;
  updatedAt: number;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'baaton-ai-chats';
const MAX_CONVOS = 50;
const SCHEMA_VERSION = 2;

function loadConvos(): StoredConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    if (parsed[0]?.schema_version !== SCHEMA_VERSION) {
      console.warn('[Baaton AI] Chat format outdated, clearing.');
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.setItem('baaton-ai-chats-cleared', '1');
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function stripHeavyParts(msg: UIMessage): UIMessage {
  return {
    ...msg,
    parts: msg.parts.map(part => {
      if (!part.type.startsWith('tool-')) return part;
      const toolPart = part as any;
      if (!toolPart.output) return toolPart;
      return {
        ...toolPart,
        output: {
          result: toolPart.output.result,
          summary: toolPart.output.summary,
          component: toolPart.output.component,
          approved: toolPart.output.approved,
          finalValues: toolPart.output.finalValues,
        },
      };
    }),
  };
}

function saveConvos(cs: StoredConversation[]) {
  try {
    const trimmed = cs.slice(0, MAX_CONVOS).map(c => ({
      ...c,
      schema_version: SCHEMA_VERSION as const,
      messages: c.messages.slice(-80).map(stripHeavyParts),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // quota exceeded
  }
}

function extractTitle(msgs: UIMessage[]): string {
  const firstUser = msgs.find(m => m.role === 'user');
  if (!firstUser) return 'New Chat';
  const text = firstUser.parts.find(p => p.type === 'text');
  return ((text as any)?.text ?? 'New Chat').slice(0, 50);
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function makeConvo(): StoredConversation {
  const now = Date.now();
  return { schema_version: SCHEMA_VERSION, id: uid(), title: '', messages: [], createdAt: now, updatedAt: now };
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AIChat() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const addNotification = useNotificationStore(s => s.addNotification);
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const SUGGESTIONS = useChatSuggestions();

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

  // ── AI SDK transport & hook ──

  const transport = useMemo(() => new DefaultChatTransport({
    api: `${import.meta.env.VITE_API_URL ?? ''}/api/v1/ai/chat`,
    prepareSendMessagesRequest: async ({ messages, body }) => {
      const token = await getToken();
      return {
        headers: { Authorization: `Bearer ${token ?? ''}` },
        body: { ...body, messages, project_ids: projects.map(p => p.id) },
      };
    },
  }), [getToken, projects]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialMessages = useMemo(() => {
    const convo = convos.find(c => c.id === activeId);
    return convo?.messages ?? [];
  }, [activeId]);

  const {
    messages, sendMessage, status, stop, regenerate,
    setMessages, addToolOutput, error,
  } = useChat({
    id: activeId ?? 'default',
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onFinish: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['milestones'], refetchType: 'all' });
    },
    onError: (err) => {
      console.error('[AI chat]', err);
    },
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

  // Refs for stable access inside effects
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // ── Sync session title to localStorage when streaming ends ──
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasActive = prevStatusRef.current === 'streaming' || prevStatusRef.current === 'submitted';
    const isDone = status === 'ready';
    prevStatusRef.current = status;
    if (!wasActive || !isDone) return;

    const msgs = messagesRef.current;
    const cid = activeIdRef.current;
    if (!msgs.length || !cid) return;

    setConvos(prev => {
      const updated = prev.map(c => {
        if (c.id !== cid) return c;
        const firstUser = msgs.find(m => m.role === 'user');
        const userText = firstUser ? getTextFromMessage(firstUser) : '';
        const title = c.title || userText.slice(0, 50) || t('aiChat.newChat');
        return { ...c, title, updatedAt: Date.now() };
      });
      saveConvos(updated);
      return updated;
    });
  }, [status, t]);

  // ── Persist messages to localStorage ──
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    setConvos(prev => {
      const updated = prev.map(c =>
        c.id === activeId
          ? {
              ...c,
              messages,
              title: c.title || extractTitle(messages),
              updatedAt: Date.now(),
              schema_version: SCHEMA_VERSION as const,
            }
          : c
      );
      saveConvos(updated);
      return updated;
    });
  }, [messages, activeId]);

  // ── One-time toast after old chats cleared ──
  useEffect(() => {
    if (sessionStorage.getItem('baaton-ai-chats-cleared') === '1') {
      sessionStorage.removeItem('baaton-ai-chats-cleared');
      addNotification({
        type: 'info',
        title: 'Conversations IA archivées',
        message: "L'IA a été mise à jour. Démarre une nouvelle conversation.",
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──

  const handleNewChat = useCallback(() => {
    const c = makeConvo();
    setConvos(prev => {
      const updated = [c, ...prev];
      saveConvos(updated);
      return updated;
    });
    setActiveId(c.id);
    setMessages([]);
  }, [setMessages]);

  const handleSwitchConvo = useCallback((id: string) => {
    setActiveId(id);
    const convo = convos.find(c => c.id === id);
    setMessages(convo?.messages ?? []);
  }, [convos, setMessages]);

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
      } else {
        setActiveId(null);
      }
      setMessages([]);
    }
  }, [activeId, convos, setMessages]);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    if (!activeId) {
      const c = makeConvo();
      setConvos(prev => {
        const updated = [c, ...prev];
        saveConvos(updated);
        return updated;
      });
      setActiveId(c.id);
    }

    await sendMessage({ text: text.trim() });
  }, [activeId, isStreaming, sendMessage]);

  const handleRegenerate = useCallback(() => {
    if (isStreaming || !messages.length) return;
    void regenerate();
  }, [messages.length, isStreaming, regenerate]);

  // ── Derived ──
  const activeConvo = convos.find(c => c.id === activeId);
  const isEmpty = messages.length === 0 && !isStreaming;
  const canSend = !isStreaming;

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
              <>
                {messages
                  .map((msg, i, arr) => {
                    const msgText = getTextFromMessage(msg);
                    const isLast = i === arr.length - 1;
                    const isThinking = msg.role === 'assistant' && isLast && isStreaming
                      && !msgText && !msg.parts.some(isToolPart);

                    return (
                      <Message from={msg.role} key={msg.id}>
                        <MessageContent>
                          {isThinking ? (
                            <div className="flex items-center gap-2 py-1">
                              <Bot size={14} className="text-accent shrink-0" />
                              <Shimmer className="text-sm text-muted/70">{t('aiChat.thinking')}</Shimmer>
                            </div>
                          ) : (
                            msg.parts.map((part, idx) => {
                              if (part.type === 'text') {
                                const text = (part as any).text as string;
                                return msg.role === 'user'
                                  ? <p key={idx} className="whitespace-pre-wrap text-sm">{text}</p>
                                  : <MessageResponse key={idx} isAnimating={isLast && status === 'streaming'}>{text}</MessageResponse>;
                              }
                              if (isToolPart(part)) {
                                return <ToolPartRenderer key={idx} part={part} addToolOutput={addToolOutput} />;
                              }
                              return null;
                            })
                          )}
                        </MessageContent>

                        {!isThinking && msgText && (
                          <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <CopyButton content={msgText} />
                            {msg.role === 'assistant' && isLast && !isStreaming && (
                              <MessageAction tooltip={t('aiChat.regenerate')} onClick={handleRegenerate}>
                                <RefreshCw size={12} />
                              </MessageAction>
                            )}
                          </MessageActions>
                        )}
                      </Message>
                    );
                  })}

                {/* Error banner */}
                {error && !isStreaming && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
                    <AlertCircle size={14} className="text-red-400 shrink-0" />
                    <p className="text-sm text-red-300">{error.message}</p>
                  </div>
                )}
              </>
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
                status={status === 'submitted' || status === 'streaming' ? 'streaming' : 'ready'}
                onStop={stop}
                className="bg-amber-500 text-black hover:bg-amber-400 rounded-lg"
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
