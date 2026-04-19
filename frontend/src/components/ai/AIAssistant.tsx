/**
 * AIAssistant — Right sidebar AI panel using AI Elements SDK.
 *
 * Same rendering quality as /ai (AIChat) but in a sidebar form factor.
 * Uses: Conversation, Message, MessageResponse, PromptInput, Shimmer, Suggestions.
 */

import { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, Trash2, Bot, Copy, Check, RefreshCw, ThumbsUp, ThumbsDown,
  Plus, MessageSquare, PanelRightClose, AlertCircle,
  LayoutDashboard, Inbox, PlusCircle, CalendarDays, FileText, TrendingUp,
} from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { shouldAutoContinueAfterApproval } from '@/lib/ai-continue';
import { useUIStore } from '@/stores/ui';
import { useNotificationStore } from '@/stores/notifications';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
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
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning';
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion';
import { ToolPartRenderer } from '@/components/ai/ToolPartRenderer';
import { BatchConfirmation } from '@/components/ai/BatchConfirmation';
import { makeThinkingMessage } from '@/lib/ai-thinking';

// ─── Helpers ────────────────────────────────────

const PROPOSE_TOOLS = ['propose_issue', 'propose_update_issue', 'propose_bulk_update', 'propose_comment'];

function isPendingProposal(part: { type: string; state?: string }): boolean {
  const toolName = part.type.replace(/^tool-/, '');
  return PROPOSE_TOOLS.includes(toolName) && (part as any).state === 'input-available';
}

function getTextFromMessage(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('');
}

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

// ─── Session persistence ───────────────────────

interface StoredSession {
  schema_version: 2;
  id: string;
  title: string;
  messages: UIMessage[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'baaton-ai-panel-sessions';
const MAX_SESSIONS = 30;
const SCHEMA_VERSION = 2;

function loadSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    if (parsed[0]?.schema_version !== SCHEMA_VERSION) {
      console.warn('[Baaton AI] Session format outdated, clearing.');
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.setItem('baaton-ai-sessions-cleared', '1');
      return [];
    }
    return parsed;
  } catch { return []; }
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

function saveSessions(ss: StoredSession[]) {
  try {
    const trimmed = ss.slice(0, MAX_SESSIONS).map(s => ({
      ...s,
      schema_version: SCHEMA_VERSION as const,
      messages: s.messages.slice(-80).map(stripHeavyParts),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota */ }
}

function extractTitle(msgs: UIMessage[]): string {
  const firstUser = msgs.find(m => m.role === 'user');
  if (!firstUser) return 'New Chat';
  const text = firstUser.parts.find(p => p.type === 'text');
  return ((text as any)?.text ?? 'New Chat').slice(0, 40);
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function makeSession(): StoredSession {
  const now = Date.now();
  return { schema_version: SCHEMA_VERSION, id: uid(), title: '', messages: [], createdAt: now, updatedAt: now };
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

// ─── Last message actions (hover) ──────────────

function LastMessageActions({
  text,
  onRegenerate,
  isStreaming,
}: {
  text: string;
  onRegenerate?: () => void;
  isStreaming: boolean;
}) {
  const { t } = useTranslation();
  if (isStreaming || !text) return null;

  return (
    <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity mt-1">
      <CopyButton content={text} />
      {onRegenerate && (
        <MessageAction tooltip={t('aiChat.regenerate')} onClick={onRegenerate}>
          <RefreshCw size={12} />
        </MessageAction>
      )}
      <MessageAction tooltip="J'aime">
        <ThumbsUp size={12} />
      </MessageAction>
      <MessageAction tooltip="Je n'aime pas">
        <ThumbsDown size={12} />
      </MessageAction>
    </MessageActions>
  );
}

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

// ─── Empty State (Baaton dashboard vibe) ───────

function getTimeGreeting(t: (key: string) => string): string {
  const hour = new Date().getHours();
  if (hour < 6) return t('ai.greetingNight') || 'Bonne nuit.';
  if (hour < 12) return t('ai.greetingMorning') || 'Bonjour.';
  if (hour < 18) return t('ai.greetingAfternoon') || 'Bon retour.';
  return t('ai.greetingEvening') || 'Bonsoir.';
}

interface EmptyStateProps {
  skillCount: number;
  projectCount: number;
  canSend: boolean;
  onSend: (text: string) => void;
}

function EmptyState({ skillCount, projectCount, canSend, onSend }: EmptyStateProps) {
  const { t } = useTranslation();
  const greeting = getTimeGreeting(t);

  const quickActions = [
    {
      id: 'overview',
      icon: LayoutDashboard,
      title: t('ai.suggestionSummary').replace(/^[\p{Emoji}\s]+/u, '') || "Vue d'ensemble",
      subtitle: 'Issues, sprints, milestones, SLA',
      prompt: t('ai.suggestionSummaryPrompt'),
    },
    {
      id: 'triage',
      icon: Inbox,
      title: t('ai.suggestionTriage').replace(/^[\p{Emoji}\s]+/u, '') || "Trier l'inbox",
      subtitle: 'Labels, priorité, assignés',
      prompt: t('ai.suggestionTriagePrompt'),
    },
    {
      id: 'create',
      icon: PlusCircle,
      title: t('ai.suggestionCreate').replace(/^[\p{Emoji}\s]+/u, '') || 'Créer une issue',
      subtitle: 'Avec description structurée',
      prompt: t('ai.suggestionCreatePrompt'),
    },
    {
      id: 'sprint',
      icon: TrendingUp,
      title: t('ai.suggestionSprint').replace(/^[\p{Emoji}\s]+/u, '') || 'Statut sprint',
      subtitle: 'Velocité, blockers, progrès',
      prompt: t('ai.suggestionSprintPrompt'),
    },
    {
      id: 'recap',
      icon: CalendarDays,
      title: t('ai.suggestionRecap').replace(/^[\p{Emoji}\s]+/u, '') || 'Activité semaine',
      subtitle: 'Tickets créés · changements de statut',
      prompt: t('ai.suggestionRecapPrompt'),
    },
    {
      id: 'prd',
      icon: FileText,
      title: 'Générer un PRD',
      subtitle: 'User stories + criteria',
      prompt: "Aide-moi à rédiger un PRD pour une nouvelle fonctionnalité. Demande-moi d'abord les détails.",
    },
  ];

  return (
    <div className="flex flex-col gap-5 py-4 px-1">
      {/* Greeting — Baaton "Good morning." style */}
      <div>
        <h2 className="text-2xl font-bold text-[--color-primary] tracking-tight">
          {greeting}
        </h2>
        <p className="text-[13px] text-[--color-muted] mt-1">
          {projectCount} projet{projectCount > 1 ? 's' : ''} · {skillCount} skills
        </p>
      </div>

      {/* Quick-action cards grid (Baaton metric card vibe) */}
      <div className="grid grid-cols-2 gap-2">
        {quickActions.map(action => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              onClick={() => onSend(action.prompt)}
              disabled={!canSend}
              className="group relative text-left rounded-xl border border-[--color-border] bg-[--color-surface] p-3 hover:border-amber-500/40 hover:bg-amber-500/5 active:scale-[0.98] active:bg-amber-500/10 transition-[transform,colors,background-color,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-500/30 will-change-transform"
            >
              <Icon size={14} className="text-amber-500 mb-1.5" />
              <div className="text-[11px] font-semibold text-[--color-primary] leading-tight">
                {action.title}
              </div>
              <div className="text-[10px] text-[--color-muted] mt-0.5 line-clamp-2 leading-snug">
                {action.subtitle}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer hint */}
      <p className="text-center text-[10px] text-[--color-muted]/70">
        Ou tape une demande en langage naturel
      </p>
    </div>
  );
}

// ─── Main Component ────────────────────────────

export function AIAssistant() {
  const { t } = useTranslation();
  const PANEL_SUGGESTIONS = useSuggestions();
  const aiPanelOpen = useUIStore(s => s.aiPanelOpen);
  const setAiPanelOpen = useUIStore(s => s.setAiPanelOpen);
  const toggleAiPanel = useUIStore(s => s.toggleAiPanel);

  const [sessionsView, setSessionsView] = useState(false);
  const [sessions, setSessions] = useState<StoredSession[]>(loadSessions);
  const [activeId, setActiveId] = useState<string | null>(() => loadSessions()[0]?.id ?? null);

  const addNotification = useNotificationStore(s => s.addNotification);
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // ── AI SDK v5+ transport & hook ──

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
    const session = sessions.find(s => s.id === activeId);
    return session?.messages ?? [];
  }, [activeId]);

  const {
    messages, sendMessage, status, stop, regenerate,
    setMessages, addToolOutput, error,
  } = useChat({
    id: activeId ?? 'default',
    transport,
    messages: initialMessages,
    // Only auto-continue after the user approves a propose_* tool. The default
    // helper would re-fire a request whenever ALL tool calls have outputs —
    // which is true for our server-resolved read tools too, causing duplicate
    // turns ("état des lieux" rendered twice, etc).
    sendAutomaticallyWhen: shouldAutoContinueAfterApproval,
    onFinish: () => {
      queryClient.invalidateQueries({ queryKey: ['issues'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['milestones'], refetchType: 'all' });
    },
    onError: (err) => {
      console.error('[AI panel]', err);
    },
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

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
    const sid = activeIdRef.current;
    if (!msgs.length || !sid) return;

    setSessions(prev => {
      const updated = prev.map(s => {
        if (s.id !== sid) return s;
        const firstUser = msgs.find(m => m.role === 'user');
        const userText = firstUser ? getTextFromMessage(firstUser) : '';
        const title = s.title || userText.slice(0, 40) || t('aiChat.newChat');
        return { ...s, title, updatedAt: Date.now() };
      });
      saveSessions(updated);
      return updated;
    });
  }, [status, t]);

  // ── Persist messages to localStorage ──
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    setSessions(prev => {
      const updated = prev.map(s =>
        s.id === activeId
          ? {
              ...s,
              messages,
              title: s.title || extractTitle(messages),
              updatedAt: Date.now(),
              schema_version: SCHEMA_VERSION as const,
            }
          : s
      );
      saveSessions(updated);
      return updated;
    });
  }, [messages, activeId]);

  // ── One-time toast after old sessions cleared ──
  useEffect(() => {
    if (sessionStorage.getItem('baaton-ai-sessions-cleared') === '1') {
      sessionStorage.removeItem('baaton-ai-sessions-cleared');
      addNotification({
        type: 'info',
        title: 'Sessions IA archivées',
        message: "L'IA a été mise à jour. Démarre une nouvelle conversation.",
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setMessages([]);
    setSessionsView(false);
  }, [setMessages]);

  const handleSwitchSession = useCallback((id: string) => {
    setActiveId(id);
    const session = sessions.find(s => s.id === id);
    setMessages(session?.messages ?? []);
    setSessionsView(false);
  }, [sessions, setMessages]);

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
      } else {
        setActiveId(null);
      }
      setMessages([]);
    }
  }, [activeId, sessions, setMessages]);

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

    await sendMessage({ text: msg });
  }, [isStreaming, activeId, sendMessage]);

  const handleRegenerate = useCallback(() => {
    if (isStreaming || !messages.length) return;
    void regenerate();
  }, [messages.length, isStreaming, regenerate]);

  const isEmpty = messages.length === 0 && !isStreaming;
  const canSend = !isStreaming;

  // ── FAB when closed ──

  if (!aiPanelOpen) {
    return (
      <button
        onClick={toggleAiPanel}
        aria-label={t('ai.openAssistant') || 'Open AI assistant (Cmd+J)'}
        // env(safe-area-inset-bottom) keeps the FAB above iOS home indicator in PWA mode.
        // Touch target 48×48 (above WCAG 2.5.5 minimum of 44).
        style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom, 0px))' }}
        className="fixed right-4 sm:right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 text-black shadow-lg transition-all duration-300 hover:scale-105 hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[--color-bg]"
      >
        <Sparkles size={20} aria-hidden="true" />
      </button>
    );
  }

  return (
    <>
      {/* Backdrop on mobile/tablet (lg- only). Hidden on lg+ where panel is docked. */}
      <button
        type="button"
        aria-label={t('ai.closeAssistant') || 'Close AI panel'}
        onClick={() => setAiPanelOpen(false)}
        className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
      />

      <aside
        role="complementary"
        aria-label={t('ai.title') || 'AI assistant'}
        // Floating right sidebar at every breakpoint — never displaces page
        // content so the user can keep clicking the visible portion of the
        // app while chatting (Linear/Cursor/Slack thread panel pattern).
        // Mobile (< sm): full-screen overlay with backdrop above.
        // sm+: 420px floating column with shadow + slide-in animation.
        className="animate-slide-in-right flex shrink-0 w-full sm:w-[420px] sm:min-w-[420px] sm:max-w-[90vw] flex-col border-l border-border bg-bg h-dvh [@supports_not(height:100dvh)]:h-screen fixed right-0 top-0 bottom-0 z-40 shadow-2xl will-change-transform"
      >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-border shrink-0 min-h-[48px]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500 shrink-0">
            <Sparkles size={14} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-primary flex items-center gap-1.5">
              <span className="truncate">{t('ai.title')}</span>
              <span className="rounded-full bg-emerald-500/20 text-emerald-400 px-1.5 py-0 text-[9px] font-medium shrink-0">
                {skillCount} skills
              </span>
            </h3>
            <p className="text-[10px] text-muted truncate">
              {projects.length} {t('aiChat.projectsLabel')} · {t('aiChat.backendAgent')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setSessionsView(!sessionsView)}
            aria-label={sessionsView ? t('aiChat.closeSessions') || 'Close sessions' : t('aiChat.openSessions') || 'Sessions'}
            aria-pressed={sessionsView}
            className={cn(
              'rounded-md inline-flex items-center justify-center min-w-[36px] min-h-[36px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40',
              sessionsView ? 'bg-surface-hover text-primary' : 'text-muted hover:text-secondary hover:bg-surface-hover',
            )}
            title="Sessions"
          >
            <MessageSquare size={16} aria-hidden="true" />
          </button>
          <button
            onClick={handleNewSession}
            aria-label={t('aiChat.newChat')}
            className="rounded-md inline-flex items-center justify-center min-w-[36px] min-h-[36px] text-muted hover:text-secondary hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
            title={t('aiChat.newChat')}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button
            onClick={() => setAiPanelOpen(false)}
            aria-label={t('ai.closeAssistant') || 'Close AI panel'}
            className="rounded-md inline-flex items-center justify-center min-w-[36px] min-h-[36px] text-muted hover:text-secondary hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
            title={t('ai.closeAssistant') || 'Close'}
          >
            <PanelRightClose size={16} aria-hidden="true" />
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
                <EmptyState
                  skillCount={skillCount}
                  projectCount={projects.length}
                  canSend={canSend}
                  onSend={handleSend}
                />
              ) : (
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
                            ) : (() => {
                              if (msg.role === 'user') {
                                return msg.parts.map((part, idx) =>
                                  part.type === 'text'
                                    ? <p key={idx} className="whitespace-pre-wrap text-[13px]">{(part as any).text}</p>
                                    : null
                                );
                              }
                              const pending = msg.parts.filter(isPendingProposal);
                              const isBatch = pending.length >= 2;
                              if (isBatch) {
                                return (
                                  <>
                                    {msg.parts.filter(p => !isPendingProposal(p)).map((part, idx) => {
                                      if (part.type === 'text') {
                                        return <MessageResponse key={idx} isAnimating={isLast && status === 'streaming'}>{(part as any).text}</MessageResponse>;
                                      }
                                      if (isToolPart(part)) {
                                        return <ToolPartRenderer key={idx} part={part} addToolOutput={addToolOutput} />;
                                      }
                                      return null;
                                    })}
                                    <BatchConfirmation parts={pending} addToolOutput={addToolOutput} />
                                  </>
                                );
                              }
                              const textParts = msg.parts.filter(p => p.type === 'text');
                              const toolParts = msg.parts.filter(isToolPart);
                              const combinedText = textParts.map(p => (p as any).text).join('\n');
                              if (toolParts.length > 0 && combinedText.length > 0) {
                                return (
                                  <>
                                    <Reasoning isStreaming={isStreaming && isLast} defaultOpen={isStreaming && isLast}>
                                      <ReasoningTrigger getThinkingMessage={makeThinkingMessage(t)} />
                                      <ReasoningContent>{combinedText}</ReasoningContent>
                                    </Reasoning>
                                    {toolParts.map((part, idx) => (
                                      <ToolPartRenderer key={`tool-${idx}`} part={part} addToolOutput={addToolOutput} />
                                    ))}
                                  </>
                                );
                              }
                              return msg.parts.map((part, idx) => {
                                if (part.type === 'text') {
                                  return <MessageResponse key={idx} isAnimating={isLast && status === 'streaming'}>{(part as any).text}</MessageResponse>;
                                }
                                if (isToolPart(part)) {
                                  return <ToolPartRenderer key={idx} part={part} addToolOutput={addToolOutput} />;
                                }
                                return null;
                              });
                            })()}
                          </MessageContent>

                          {isLast && msg.role === 'assistant' && (
                            <LastMessageActions
                              text={msgText}
                              onRegenerate={handleRegenerate}
                              isStreaming={isStreaming}
                            />
                          )}
                        </Message>
                      );
                    })}

                  {error && !isStreaming && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                      <AlertCircle size={14} className="text-red-400 shrink-0" />
                      <p className="text-xs text-red-300">{error.message}</p>
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

          {/* Input — AI Elements PromptInput. Bottom padding includes iOS safe-area. */}
          <div
            className="shrink-0 border-t border-[--color-border] bg-[--color-bg] px-3 pt-3"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
          >
            <PromptInput onSubmit={({ text }) => { if (text.trim()) void handleSend(text); }}>
              <PromptInputTextarea
                placeholder={t('ai.placeholder')}
                disabled={!canSend}
                // text-base (16px) on mobile prevents iOS from auto-zooming the field on focus.
                // Drops back to 13px on sm+ for density.
                className="text-base sm:text-[13px]"
                enterKeyHint="send"
                autoCapitalize="sentences"
                autoCorrect="on"
              />
              <PromptInputFooter>
                <span className="text-[10px] text-[--color-muted] truncate">
                  {t('aiChat.backendAgent')} · {skillCount} skills
                </span>
                <PromptInputSubmit
                  status={status === 'submitted' || status === 'streaming' ? 'streaming' : 'ready'}
                  onStop={stop}
                  className="bg-amber-500 text-black hover:bg-amber-400 rounded-lg"
                />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </>
      )}
      </aside>
    </>
  );
}
