/**
 * AIChat — Full-page AI Chat experience for Baaton
 * Inspired by ai-sdk.dev/elements conversation patterns
 *
 * Features:
 * - Conversation sidebar with history
 * - Collapsible tool execution cards
 * - Message copy + regenerate actions
 * - Streaming shimmer while generating
 * - Suggestion chips
 * - Auto-growing textarea with Cmd+Enter submit
 * - Full localStorage persistence
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import {
  Bot, User, Copy, RefreshCw, Plus, Trash2,
  Send, ChevronDown, Wrench, CheckCircle2, XCircle,
  Sparkles, Clock, MessageSquare,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/shared/MarkdownView';
import { generateAIResponse } from '@/lib/ai-engine';
import { createInitialState } from '@/lib/ai-state';
import { ALL_SKILL_DECLARATIONS } from '@/lib/ai-skills';
import type { AIStateContext } from '@/lib/ai-state';
import type { SkillResult } from '@/lib/ai-skills';
import type { Issue } from '@/lib/types';

// ─── Types ────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  skills?: SkillResult[];
  usage?: { inputTokens: number; outputTokens: number };
}

interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ─── LocalStorage Helpers ─────────────────────

const STORAGE_KEY = 'baaton-ai-conversations';
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 100;

function loadConversations(): ChatConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveConversations(convos: ChatConversation[]) {
  try {
    const trimmed = convos.slice(0, MAX_CONVERSATIONS).map((c) => ({
      ...c,
      messages: c.messages.slice(-MAX_MESSAGES).map((m) => ({
        ...m,
        skills: m.skills?.map((s) => ({ ...s, data: undefined })),
      })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateTitle(firstMessage: string): string {
  return firstMessage.length > 50
    ? firstMessage.slice(0, 50) + '…'
    : firstMessage;
}

function newConversation(): ChatConversation {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    title: 'New Chat',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ─── ToolCard Component ───────────────────────

interface ToolCardProps {
  result: SkillResult & { executionTimeMs?: number };
}

function ToolCard({ result }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2 rounded-lg border border-border bg-surface-hover/30 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-surface-hover/50 transition-colors"
      >
        <Wrench size={11} className="text-accent shrink-0" />
        <span className="font-mono text-secondary truncate flex-1">{result.skill}</span>
        {result.success ? (
          <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
        ) : (
          <XCircle size={11} className="text-red-400 shrink-0" />
        )}
        {result.executionTimeMs !== undefined && (
          <span className="flex items-center gap-0.5 text-muted/70 shrink-0">
            <Clock size={9} />
            <span>{result.executionTimeMs}ms</span>
          </span>
        )}
        {result.summary && (
          <span className="text-muted/70 truncate hidden sm:block max-w-[200px]">
            {result.summary}
          </span>
        )}
        <ChevronDown
          size={11}
          className={cn('text-muted shrink-0 transition-transform duration-200', expanded && 'rotate-180')}
        />
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-border/60 bg-surface/50">
          {result.error && (
            <p className="text-xs text-red-400 mb-2">{result.error}</p>
          )}
          {result.data !== undefined && (
            <pre className="text-[10px] font-mono text-muted overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all leading-relaxed">
              {JSON.stringify(result.data, null, 2).slice(0, 2000)}
              {JSON.stringify(result.data, null, 2).length > 2000 && '\n… (truncated)'}
            </pre>
          )}
          {!result.data && !result.error && (
            <p className="text-xs text-muted italic">{result.summary || 'No data'}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── StreamingShimmer Component ───────────────

function StreamingShimmer({ skillName }: { skillName?: string }) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-3 py-4 px-4">
      <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
        <Bot size={14} className="text-accent" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        {skillName && (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted">
            <Wrench size={10} className="text-accent" />
            <span className="font-mono">{skillName}…</span>
          </div>
        )}
        <div className="flex gap-1.5 py-1">
          <div className="w-2 h-2 rounded-full bg-accent/50 animate-bounce [animation-delay:0ms]" />
          <div className="w-2 h-2 rounded-full bg-accent/50 animate-bounce [animation-delay:150ms]" />
          <div className="w-2 h-2 rounded-full bg-accent/50 animate-bounce [animation-delay:300ms]" />
        </div>
        {skillName && (
          <p className="text-xs text-muted mt-1">
            {t('aiChat.executingSkill', { name: skillName })}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── MessageItem Component ────────────────────

interface MessageItemProps {
  message: ChatMessage;
  isLast: boolean;
  onCopy: (content: string) => void;
  onRegenerate?: () => void;
}

function MessageItem({ message, isLast, onCopy, onRegenerate }: MessageItemProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'group flex gap-3 py-4 px-4 hover:bg-surface-hover/20 transition-colors',
        isUser && 'flex-row-reverse',
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5',
          isUser ? 'bg-primary/10' : 'bg-accent/10',
        )}
      >
        {isUser ? (
          <User size={14} className="text-secondary" />
        ) : (
          <Bot size={14} className="text-accent" />
        )}
      </div>

      {/* Content */}
      <div className={cn('flex-1 min-w-0', isUser && 'flex flex-col items-end')}>
        {/* Role label */}
        <div className={cn('text-[11px] font-medium mb-1.5', isUser ? 'text-secondary' : 'text-accent')}>
          {isUser ? t('aiChat.you') : t('aiChat.assistant')}
        </div>

        {/* Tool executions */}
        {!isUser && message.skills && message.skills.length > 0 && (
          <div className="w-full max-w-2xl mb-2">
            {message.skills.map((skill, i) => (
              <ToolCard key={`${skill.skill}-${i}`} result={skill} />
            ))}
          </div>
        )}

        {/* Message content */}
        {isUser ? (
          <div className="rounded-2xl rounded-tr-sm bg-accent/10 border border-accent/20 px-4 py-2.5 max-w-[80%]">
            <p className="text-sm text-primary leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none w-full">
            <MarkdownView content={message.content} />
          </div>
        )}

        {/* Actions */}
        <div
          className={cn(
            'flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity',
            isUser && 'justify-end',
          )}
        >
          <button
            onClick={handleCopy}
            title={t('aiChat.copy')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
          >
            <Copy size={11} />
            {copied ? t('aiChat.copied') : t('aiChat.copy')}
          </button>
          {!isUser && isLast && onRegenerate && (
            <button
              onClick={onRegenerate}
              title={t('aiChat.regenerate')}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
            >
              <RefreshCw size={11} />
              {t('aiChat.regenerate')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ConversationItem Component ───────────────

interface ConversationItemProps {
  conversation: ChatConversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function ConversationItem({ conversation, isActive, onSelect, onDelete }: ConversationItemProps) {
  const { t } = useTranslation();
  const [hovering, setHovering] = useState(false);

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors',
        isActive ? 'bg-surface-hover text-primary' : 'text-secondary hover:bg-surface hover:text-primary',
      )}
      onClick={onSelect}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <MessageSquare size={13} className="shrink-0 text-muted" />
      <span className="flex-1 text-xs truncate">{conversation.title}</span>
      {(hovering || isActive) && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title={t('aiChat.deleteConversation')}
          className="shrink-0 rounded p-0.5 text-muted hover:text-red-400 transition-colors"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

// ─── SuggestionChips Component ────────────────

interface SuggestionChipsProps {
  onSelect: (prompt: string) => void;
  disabled: boolean;
}

function SuggestionChips({ onSelect, disabled }: SuggestionChipsProps) {
  const { t } = useTranslation();

  const suggestions = [
    { label: t('ai.suggestionSummary'), prompt: t('ai.suggestionSummaryPrompt') },
    { label: t('ai.suggestionBlockers'), prompt: t('ai.suggestionBlockersPrompt') },
    { label: t('ai.suggestionTodo'), prompt: t('ai.suggestionTodoPrompt') },
    { label: t('ai.suggestionCreate'), prompt: t('ai.suggestionCreatePrompt') },
    { label: t('ai.suggestionReprioritize'), prompt: t('ai.suggestionReprioritizePrompt') },
    { label: t('ai.suggestionRecap'), prompt: t('ai.suggestionRecapPrompt') },
  ];

  return (
    <div className="flex flex-wrap gap-2 px-4 pb-2">
      {suggestions.map((s) => (
        <button
          key={s.label}
          onClick={() => onSelect(s.prompt)}
          disabled={disabled}
          className={cn(
            'rounded-full border border-border bg-surface px-3 py-1 text-xs text-secondary transition-all',
            'hover:border-accent/50 hover:text-primary hover:bg-surface-hover',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ─── ChatInput Component ──────────────────────

interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  skillCount: number;
}

function ChatInput({ value, onChange, onSubmit, loading, skillCount }: ChatInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!loading && value.trim()) onSubmit();
    }
    // Enter without shift/cmd = newline (natural behavior)
  };

  return (
    <div className="border border-border rounded-xl bg-surface overflow-hidden focus-within:border-accent/40 transition-colors">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('ai.placeholder')}
        disabled={loading}
        rows={1}
        className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-primary placeholder:text-muted outline-none disabled:opacity-50"
        style={{ minHeight: '44px', maxHeight: '200px' }}
      />
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[10px] text-muted">
          Gemini Flash · {t('ai.skills', { count: skillCount })}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted hidden sm:block">⌘↵</span>
          <button
            onClick={onSubmit}
            disabled={loading || !value.trim()}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
              'bg-accent text-white hover:bg-accent/90',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            {loading ? (
              <div className="w-3 h-3 rounded-full border border-white/40 border-t-white animate-spin" />
            ) : (
              <Send size={12} />
            )}
            {t('aiChat.send')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Empty State Component ────────────────────

function EmptyState({ onSuggestion, loading }: { onSuggestion: (p: string) => void; loading: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
        <Sparkles size={28} className="text-accent" />
      </div>
      <h2 className="text-lg font-semibold text-primary mb-2">{t('aiChat.emptyTitle')}</h2>
      <p className="text-sm text-muted mb-8 max-w-sm">{t('aiChat.emptyDesc')}</p>
      <SuggestionChips onSelect={onSuggestion} disabled={loading} />
    </div>
  );
}

// ─── Main AIChat Page ─────────────────────────

export default function AIChat() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const apiClient = useApi();

  // ─── Conversation state ──────────────────
  const [conversations, setConversations] = useState<ChatConversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const convos = loadConversations();
    return convos.length > 0 ? convos[0].id : null;
  });

  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [currentSkill, setCurrentSkill] = useState<string | null>(null);
  const [aiStateContext, setAiStateContext] = useState<AIStateContext>(createInitialState);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ─── Active conversation ─────────────────
  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeConversation?.messages ?? [];

  // ─── Data fetching ───────────────────────
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

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

  // ─── Scroll to bottom ───────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ─── Persist conversations ───────────────
  const persistConversations = useCallback((convos: ChatConversation[]) => {
    setConversations(convos);
    saveConversations(convos);
  }, []);

  // ─── Create new conversation ─────────────
  const createNewConversation = useCallback(() => {
    const convo = newConversation();
    const updated = [convo, ...conversations];
    persistConversations(updated);
    setActiveId(convo.id);
    setAiStateContext(createInitialState());
    setInput('');
  }, [conversations, persistConversations]);

  // ─── Delete conversation ─────────────────
  const deleteConversation = useCallback((id: string) => {
    const updated = conversations.filter((c) => c.id !== id);
    persistConversations(updated);
    if (activeId === id) {
      setActiveId(updated.length > 0 ? updated[0].id : null);
    }
  }, [conversations, persistConversations, activeId]);

  // ─── Send message ────────────────────────
  const handleSend = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    setInput('');

    // Ensure we have an active conversation
    let currentActiveId = activeId;
    if (!currentActiveId) {
      const convo = newConversation();
      const updated = [convo, ...conversations];
      persistConversations(updated);
      setActiveId(convo.id);
      currentActiveId = convo.id;
    }

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: msg,
      timestamp: Date.now(),
    };

    // Add user message
    setConversations((prev) => {
      const updated = prev.map((c) => {
        if (c.id !== currentActiveId) return c;
        const msgs = [...c.messages, userMsg];
        return {
          ...c,
          messages: msgs,
          title: c.messages.length === 0 ? generateTitle(msg) : c.title,
          updatedAt: new Date().toISOString(),
        };
      });
      saveConversations(updated);
      return updated;
    });

    setLoading(true);
    setCurrentSkill(null);

    try {
      // Build history from current conversation (excluding the message we just added)
      const currentConvo = conversations.find((c) => c.id === currentActiveId);
      const history = (currentConvo?.messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));

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

      setAiStateContext(response.stateContext);

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: response.text,
        timestamp: Date.now(),
        skills: response.skillsExecuted,
        usage: {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        },
      };

      setConversations((prev) => {
        const updated = prev.map((c) => {
          if (c.id !== currentActiveId) return c;
          return {
            ...c,
            messages: [...c.messages, assistantMsg],
            updatedAt: new Date().toISOString(),
          };
        });
        saveConversations(updated);
        return updated;
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t('ai.errorGeneric');
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `⚠️ ${errMsg}`,
        timestamp: Date.now(),
      };
      setConversations((prev) => {
        const updated = prev.map((c) => {
          if (c.id !== currentActiveId) return c;
          return {
            ...c,
            messages: [...c.messages, errorMsg],
            updatedAt: new Date().toISOString(),
          };
        });
        saveConversations(updated);
        return updated;
      });
    } finally {
      setLoading(false);
      setCurrentSkill(null);
    }
  }, [input, loading, activeId, conversations, persistConversations, getToken, projects, allIssuesByProject, apiClient, aiStateContext, t]);

  // ─── Regenerate last response ────────────
  const handleRegenerate = useCallback(() => {
    if (!activeConversation || loading) return;
    const msgs = activeConversation.messages;
    // Find the last user message
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;

    const lastUserMsg = msgs[lastUserIdx].content;

    // Remove messages after (and including) the last assistant message
    const truncated = msgs.slice(0, lastUserIdx + 1);
    // Also remove the last user message since handleSend will re-add it
    const withoutLast = truncated.slice(0, lastUserIdx);

    setConversations((prev) => {
      const updated = prev.map((c) => {
        if (c.id !== activeId) return c;
        return { ...c, messages: withoutLast, updatedAt: new Date().toISOString() };
      });
      saveConversations(updated);
      return updated;
    });

    handleSend(lastUserMsg);
  }, [activeConversation, loading, activeId, handleSend]);

  // ─── Copy to clipboard ───────────────────
  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content).catch(() => {
      // fallback
      const el = document.createElement('textarea');
      el.value = content;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    });
  }, []);

  const skillCount = ALL_SKILL_DECLARATIONS.length;
  const showEmpty = messages.length === 0 && !loading;

  return (
    <div className="flex h-full bg-bg overflow-hidden">
      {/* ─── Conversation Sidebar ──────────── */}
      <aside className="w-60 shrink-0 flex flex-col border-r border-border bg-bg hidden md:flex">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <span className="text-sm font-semibold text-primary">{t('aiChat.title')}</span>
          </div>
          <button
            onClick={createNewConversation}
            title={t('aiChat.newChat')}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-secondary transition-colors"
          >
            <Plus size={15} />
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {conversations.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-xs text-muted">{t('aiChat.noConversations')}</p>
            </div>
          ) : (
            conversations.map((c) => (
              <ConversationItem
                key={c.id}
                conversation={c}
                isActive={c.id === activeId}
                onSelect={() => {
                  setActiveId(c.id);
                  setAiStateContext(createInitialState());
                }}
                onDelete={() => deleteConversation(c.id)}
              />
            ))
          )}
        </div>

        {/* Context panel */}
        <div className="border-t border-border p-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            {t('aiChat.context')}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{t('aiChat.skills')}</span>
            <span className="text-xs font-mono text-accent">{skillCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{t('aiChat.model')}</span>
            <span className="text-xs font-mono text-secondary">Gemini Flash</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{t('aiChat.projects')}</span>
            <span className="text-xs font-mono text-secondary">{projects.length}</span>
          </div>
        </div>
      </aside>

      {/* ─── Main Chat Area ────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar (mobile + desktop) */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {/* Mobile: show sidebar toggle placeholder */}
            <Sparkles size={15} className="text-accent md:hidden" />
            <span className="text-sm font-semibold text-primary">
              {activeConversation?.title ?? t('aiChat.newChat')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile: new chat button */}
            <button
              onClick={createNewConversation}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-secondary transition-colors"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">{t('aiChat.newChat')}</span>
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          {showEmpty ? (
            <EmptyState onSuggestion={handleSend} loading={loading} />
          ) : (
            <div className="divide-y divide-border/30">
              {messages.map((msg, i) => (
                <MessageItem
                  key={msg.id}
                  message={msg}
                  isLast={i === messages.length - 1}
                  onCopy={handleCopy}
                  onRegenerate={
                    i === messages.length - 1 && msg.role === 'assistant'
                      ? handleRegenerate
                      : undefined
                  }
                />
              ))}
              {loading && <StreamingShimmer skillName={currentSkill ?? undefined} />}
              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
        </div>

        {/* Bottom: suggestions + input */}
        <div className="shrink-0 border-t border-border bg-bg">
          {/* Suggestion chips — only show on new/short conversations */}
          {messages.length < 2 && !loading && (
            <SuggestionChips onSelect={handleSend} disabled={loading} />
          )}

          {/* Input area */}
          <div className="px-4 pb-4 pt-2">
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={handleSend}
              loading={loading}
              skillCount={skillCount}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
