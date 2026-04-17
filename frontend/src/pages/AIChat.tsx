/**
 * AIChat — Full-page AI Chat for Baaton
 *
 * Patterns adopted from ai-sdk.dev/elements (2026):
 * - Message parts rendering (text, tool, reasoning, error)
 * - Status states (ready → submitted → streaming → ready)
 * - Confirmation pattern for destructive actions
 * - Stop/Regenerate controls
 * - Collapsible tool execution cards with timing
 * - Streaming shimmer + skeleton
 * - Auto-scroll with "scroll to bottom" button
 * - Enter to send, Shift+Enter for newline
 * - Mobile-first responsive sidebar
 * - localStorage conversation persistence
 */

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import {
  Bot, User, Copy, Check, RefreshCw, Plus, Trash2, Send, Square,
  ChevronDown, Wrench, CheckCircle2, XCircle, Sparkles, Clock,
  MessageSquare, PanelLeftClose, PanelLeft, AlertCircle, ArrowDown,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/shared/MarkdownView';
import { generateAIResponse } from '@/lib/ai-engine';
import { createInitialState } from '@/lib/ai-state';
import { TOOL_SCHEMAS } from '@/lib/ai-skills';
import type { AIStateContext } from '@/lib/ai-state';
import type { SkillResult } from '@/lib/ai-skills';
import type { Issue } from '@/lib/types';

// ─── Types ────────────────────────────────────

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  skills?: SkillResult[];
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ─── Constants ────────────────────────────────

const STORAGE_KEY = 'baaton-ai-chats';
const MAX_CONVOS = 50;

// ─── Persistence ──────────────────────────────

function loadConvos(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveConvos(cs: Conversation[]) {
  try {
    const trimmed = cs.slice(0, MAX_CONVOS).map(c => ({
      ...c,
      messages: c.messages.slice(-100).map(m => ({ ...m, skills: m.skills?.map(s => ({ ...s, data: undefined })) })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota exceeded */ }
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function makeConvo(): Conversation {
  const now = Date.now();
  return { id: uid(), title: '', messages: [], createdAt: now, updatedAt: now };
}

// ─── ToolCard ─────────────────────────────────

const ToolCard = memo(function ToolCard({ result }: { result: SkillResult & { executionTimeMs?: number } }) {
  const [open, setOpen] = useState(false);
  const ok = result.success;

  return (
    <div className="my-1.5 rounded-lg border border-border/60 bg-surface/40 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-surface-hover/40 transition-colors"
      >
        <Wrench size={12} className="text-accent shrink-0" />
        <span className="font-mono text-secondary truncate flex-1">{result.skill}</span>
        {ok ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-red-400" />}
        {result.executionTimeMs != null && (
          <span className="flex items-center gap-0.5 text-muted/60 tabular-nums">
            <Clock size={9} />{result.executionTimeMs}ms
          </span>
        )}
        <ChevronDown size={12} className={cn('text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-3 py-2 border-t border-border/40 bg-surface/30">
          {result.error && <p className="text-xs text-red-400 mb-1">{result.error}</p>}
          {result.summary && <p className="text-xs text-muted">{result.summary}</p>}
          {result.data != null && (
            <pre className="mt-1 text-[10px] font-mono text-muted/80 max-h-32 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(result.data, null, 2).slice(0, 1500)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Shimmer (submitted/streaming state) ──────

function Shimmer({ status, skill }: { status: ChatStatus; skill?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-3 py-4 px-4 md:px-6 animate-in fade-in duration-300">
      <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
        <Bot size={14} className="text-accent" />
      </div>
      <div className="flex-1 pt-0.5 space-y-2">
        {skill && (
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Wrench size={10} className="text-accent animate-spin" />
            <span className="font-mono">{skill}</span>
          </div>
        )}
        {status === 'submitted' ? (
          <div className="space-y-2 max-w-md">
            <div className="h-3 rounded-full bg-surface-hover animate-pulse w-3/4" />
            <div className="h-3 rounded-full bg-surface-hover animate-pulse w-1/2" />
          </div>
        ) : (
          <div className="flex gap-1.5">
            {[0, 150, 300].map(d => (
              <div key={d} className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
        )}
        {status === 'submitted' && (
          <p className="text-[11px] text-muted/60">{t('aiChat.thinking')}</p>
        )}
      </div>
    </div>
  );
}

// ─── MessageBubble ────────────────────────────

const MessageBubble = memo(function MessageBubble({
  message, isLast, onCopy, onRegenerate,
}: {
  message: ChatMessage;
  isLast: boolean;
  onCopy: (s: string) => void;
  onRegenerate?: () => void;
}) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={cn('group flex gap-3 py-4 px-4 md:px-6', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={cn(
        'w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5',
        isUser ? 'bg-primary/10' : 'bg-accent/10',
      )}>
        {isUser ? <User size={14} className="text-secondary" /> : <Bot size={14} className="text-accent" />}
      </div>

      <div className={cn('flex-1 min-w-0 max-w-3xl', isUser && 'flex flex-col items-end')}>
        {/* Tool cards (before text) */}
        {!isUser && message.skills && message.skills.length > 0 && (
          <div className="w-full mb-2">
            {message.skills.map((s, i) => <ToolCard key={`${s.skill}-${i}`} result={s} />)}
          </div>
        )}

        {/* Error state */}
        {message.error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 mb-2">
            <AlertCircle size={14} className="text-red-400 shrink-0" />
            <p className="text-xs text-red-300">{message.error}</p>
          </div>
        )}

        {/* Content */}
        {isUser ? (
          <div className="rounded-2xl rounded-tr-sm bg-accent/10 border border-accent/20 px-4 py-2.5 max-w-[85%]">
            <p className="text-sm text-primary leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none">
            <MarkdownView content={message.content} />
          </div>
        )}

        {/* Token usage badge */}
        {!isUser && message.usage && (
          <div className="mt-1.5 text-[10px] text-muted/50 tabular-nums">
            {message.usage.inputTokens + message.usage.outputTokens} tokens
          </div>
        )}

        {/* Hover actions */}
        <div className={cn(
          'flex gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity',
          isUser && 'justify-end',
        )}>
          <button onClick={handleCopy} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-secondary hover:bg-surface-hover transition-colors">
            {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
            {copied ? t('aiChat.copied') : t('aiChat.copy')}
          </button>
          {!isUser && isLast && onRegenerate && (
            <button onClick={onRegenerate} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-secondary hover:bg-surface-hover transition-colors">
              <RefreshCw size={11} />{t('aiChat.regenerate')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

// ─── ChatInput ────────────────────────────────

function ChatInput({
  value, onChange, onSubmit, onStop, status, skillCount,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  status: ChatStatus;
  skillCount: number;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const isActive = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  // Focus on mount
  useEffect(() => { ref.current?.focus(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter = send, Shift+Enter = newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isActive && value.trim()) onSubmit();
    }
  };

  return (
    <div className="relative border border-border rounded-xl bg-surface overflow-hidden focus-within:border-accent/40 focus-within:ring-1 focus-within:ring-accent/10 transition-all">
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('ai.placeholder')}
        disabled={isActive}
        rows={1}
        className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-primary placeholder:text-muted/50 outline-none disabled:opacity-50"
        style={{ minHeight: '44px', maxHeight: '160px' }}
      />
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[10px] text-muted/60">
          Gemini Flash · {skillCount} {t('aiChat.skillsLabel')}
        </span>
        <div className="flex items-center gap-2">
          <kbd className="hidden sm:inline text-[10px] text-muted/40 border border-border/50 rounded px-1 py-0.5">⏎</kbd>
          {isActive ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              <Square size={10} fill="currentColor" />{t('aiChat.stop')}
            </button>
          ) : (
            <button
              onClick={onSubmit}
              disabled={!value.trim()}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={12} />{t('aiChat.send')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SuggestionChips ──────────────────────────

function SuggestionChips({ onSelect, disabled }: { onSelect: (p: string) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const chips = useMemo(() => [
    { label: t('ai.suggestionSummary'), prompt: t('ai.suggestionSummaryPrompt') },
    { label: t('ai.suggestionTriage'), prompt: t('ai.suggestionTriagePrompt') },
    { label: t('ai.suggestionCreate'), prompt: t('ai.suggestionCreatePrompt') },
    { label: t('ai.suggestionAutomation'), prompt: t('ai.suggestionAutomationPrompt') },
    { label: t('ai.suggestionSprint'), prompt: t('ai.suggestionSprintPrompt') },
    { label: t('ai.suggestionBatch'), prompt: t('ai.suggestionBatchPrompt') },
    { label: t('ai.suggestionRecap'), prompt: t('ai.suggestionRecapPrompt') },
    { label: t('ai.suggestionSearch'), prompt: t('ai.suggestionSearchPrompt') },
  ], [t]);

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {chips.map(c => (
        <button
          key={c.label}
          onClick={() => onSelect(c.prompt)}
          disabled={disabled}
          className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs text-secondary hover:border-accent/40 hover:text-primary hover:bg-surface-hover disabled:opacity-30 transition-all"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

// ─── EmptyState ───────────────────────────────

function EmptyState({ onSuggestion, disabled }: { onSuggestion: (p: string) => void; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full px-6">
      <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-5">
        <Sparkles size={32} className="text-accent" />
      </div>
      <h2 className="text-xl font-semibold text-primary mb-2">{t('aiChat.emptyTitle')}</h2>
      <p className="text-sm text-muted mb-8 max-w-md text-center leading-relaxed">{t('aiChat.emptyDesc')}</p>
      <SuggestionChips onSelect={onSuggestion} disabled={disabled} />
    </div>
  );
}

// ─── ConversationItem ─────────────────────────

function ConvoItem({ c, active, onSelect, onDelete }: {
  c: Conversation; active: boolean; onSelect: () => void; onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors',
        active ? 'bg-surface-hover text-primary' : 'text-secondary hover:bg-surface/80 hover:text-primary',
      )}
    >
      <MessageSquare size={13} className="shrink-0 text-muted/60" />
      <span className="flex-1 text-xs truncate">{c.title || 'New Chat'}</span>
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="shrink-0 rounded p-0.5 text-transparent group-hover:text-muted hover:!text-red-400 transition-colors"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

// ─── ScrollToBottom button ────────────────────

function ScrollBtn({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-surface border border-border shadow-lg px-3 py-1.5 text-xs text-secondary hover:bg-surface-hover transition-all animate-in slide-in-from-bottom-2"
    >
      <ArrowDown size={12} />New messages
    </button>
  );
}

// ─── Main Component ───────────────────────────

export default function AIChat() {
  const { t } = useTranslation();
  const { getToken } = useAuth();
  const apiClient = useApi();

  // State
  const [convos, setConvos] = useState<Conversation[]>(loadConvos);
  const [activeId, setActiveId] = useState<string | null>(() => loadConvos()[0]?.id ?? null);
  const [status, setStatus] = useState<ChatStatus>('ready');
  const [input, setInput] = useState('');
  const [currentSkill, setCurrentSkill] = useState<string | null>(null);
  const [aiState, setAiState] = useState<AIStateContext>(createInitialState);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Derived
  const active = convos.find(c => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  const skillCount = Object.keys(TOOL_SCHEMAS).length;
  const isEmpty = messages.length === 0 && status === 'ready';

  // Data
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  const { data: allIssues = {} } = useQuery({
    queryKey: ['ai-issues', projects.map(p => p.id).join()],
    queryFn: async () => {
      const result: Record<string, Issue[]> = {};
      await Promise.all(projects.map(async p => {
        try { result[p.id] = await apiClient.issues.listByProject(p.id, { limit: 500 }); }
        catch { result[p.id] = []; }
      }));
      return result;
    },
    enabled: projects.length > 0,
    staleTime: 30_000,
  });

  // Scroll management
  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages.length, status, scrollToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(dist > 200);
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, []);

  // Persistence helper
  const persist = useCallback((cs: Conversation[]) => {
    setConvos(cs);
    saveConvos(cs);
  }, []);

  // New conversation
  const newChat = useCallback(() => {
    const c = makeConvo();
    persist([c, ...convos]);
    setActiveId(c.id);
    setAiState(createInitialState());
    setInput('');
  }, [convos, persist]);

  // Delete conversation
  const deleteChat = useCallback((id: string) => {
    const updated = convos.filter(c => c.id !== id);
    persist(updated);
    if (activeId === id) setActiveId(updated[0]?.id ?? null);
  }, [convos, persist, activeId]);

  // Stop generation
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('ready');
  }, []);

  // Send message
  const handleSend = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || status !== 'ready') return;
    setInput('');

    // Ensure active conversation
    let cid = activeId;
    if (!cid) {
      const c = makeConvo();
      const updated = [c, ...convos];
      persist(updated);
      setActiveId(c.id);
      cid = c.id;
    }

    const userMsg: ChatMessage = { id: uid(), role: 'user', content: msg, timestamp: Date.now() };

    // Add user message + update title
    setConvos(prev => {
      const updated = prev.map(c => {
        if (c.id !== cid) return c;
        return {
          ...c,
          messages: [...c.messages, userMsg],
          title: c.title || (msg.length > 50 ? msg.slice(0, 50) + '…' : msg),
          updatedAt: Date.now(),
        };
      });
      saveConvos(updated);
      return updated;
    });

    setStatus('submitted');
    setCurrentSkill(null);
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const currentConvo = convos.find(c => c.id === cid);
      const history = (currentConvo?.messages ?? []).map(m => ({ role: m.role, content: m.content }));

      setStatus('streaming');
      const token = await getToken();

      const response = await generateAIResponse(
        msg, projects, allIssues, history,
        apiClient as unknown as Parameters<typeof generateAIResponse>[4],
        aiState, token || undefined,
      );

      if (abort.signal.aborted) return;

      setAiState(response.stateContext);

      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: response.text,
        timestamp: Date.now(),
        skills: response.skillsExecuted,
        usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
      };

      setConvos(prev => {
        const updated = prev.map(c => {
          if (c.id !== cid) return c;
          return { ...c, messages: [...c.messages, assistantMsg], updatedAt: Date.now() };
        });
        saveConvos(updated);
        return updated;
      });
      setStatus('ready');
    } catch (err) {
      if (abort.signal.aborted) return;
      const errText = err instanceof Error ? err.message : t('ai.errorGeneric');
      const errMsg: ChatMessage = {
        id: uid(), role: 'assistant', content: '', timestamp: Date.now(),
        error: errText,
      };
      setConvos(prev => {
        const updated = prev.map(c => {
          if (c.id !== cid) return c;
          return { ...c, messages: [...c.messages, errMsg], updatedAt: Date.now() };
        });
        saveConvos(updated);
        return updated;
      });
      setStatus('error');
    }
  }, [input, status, activeId, convos, persist, getToken, projects, allIssues, apiClient, aiState, t]);

  // Regenerate
  const handleRegenerate = useCallback(() => {
    if (!active || status !== 'ready' && status !== 'error') return;
    const msgs = active.messages;
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const lastUserMsg = msgs[lastUserIdx].content;

    // Remove from last user message onward
    setConvos(prev => {
      const updated = prev.map(c => {
        if (c.id !== activeId) return c;
        return { ...c, messages: c.messages.slice(0, lastUserIdx), updatedAt: Date.now() };
      });
      saveConvos(updated);
      return updated;
    });
    setStatus('ready');
    // Small delay to let state update
    setTimeout(() => handleSend(lastUserMsg), 50);
  }, [active, status, activeId, handleSend]);

  // Copy
  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content).catch(() => {});
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── Sidebar ─── */}
      <aside className={cn(
        'flex flex-col border-r border-border bg-bg transition-all duration-200 shrink-0',
        sidebarOpen ? 'w-60' : 'w-0 border-r-0',
        // Mobile: overlay
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
              <button onClick={newChat} title={t('aiChat.newChat')} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-secondary transition-colors">
                <Plus size={14} />
              </button>
              <button onClick={() => setSidebarOpen(false)} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-secondary transition-colors md:hidden">
                <PanelLeftClose size={14} />
              </button>
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {convos.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted/60">{t('aiChat.noConversations')}</p>
            ) : convos.map(c => (
              <ConvoItem
                key={c.id}
                c={c}
                active={c.id === activeId}
                onSelect={() => { setActiveId(c.id); setAiState(createInitialState()); }}
                onDelete={() => deleteChat(c.id)}
              />
            ))}
          </div>

          {/* Context panel */}
          <div className="border-t border-border p-3 space-y-1.5 shrink-0">
            <div className="text-[9px] font-semibold uppercase tracking-widest text-muted/50 mb-1.5">{t('aiChat.context')}</div>
            {[
              [t('aiChat.skillsLabel'), `${skillCount}`],
              [t('aiChat.model'), 'Gemini Flash'],
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
        <div className="fixed inset-0 bg-black/30 z-10 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ─── Main area ─── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover transition-colors">
              <PanelLeft size={15} />
            </button>
          )}
          <span className="text-sm font-medium text-primary truncate flex-1">
            {active?.title || t('aiChat.newChat')}
          </span>
          <button onClick={newChat} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-secondary transition-colors">
            <Plus size={13} /><span className="hidden sm:inline">{t('aiChat.newChat')}</span>
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
          {isEmpty ? (
            <EmptyState onSuggestion={handleSend} disabled={status !== 'ready'} />
          ) : (
            <div className="divide-y divide-border/20 pb-4">
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isLast={i === messages.length - 1}
                  onCopy={handleCopy}
                  onRegenerate={i === messages.length - 1 && msg.role === 'assistant' ? handleRegenerate : undefined}
                />
              ))}
              {(status === 'submitted' || status === 'streaming') && (
                <Shimmer status={status} skill={currentSkill ?? undefined} />
              )}
              <div ref={endRef} className="h-2" />
            </div>
          )}

          <ScrollBtn visible={showScrollBtn} onClick={scrollToBottom} />
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t border-border bg-bg px-4 pb-4 pt-3 space-y-2">
          {/* Suggestion chips for short conversations */}
          {messages.length > 0 && messages.length < 3 && status === 'ready' && (
            <SuggestionChips onSelect={handleSend} disabled={status !== 'ready'} />
          )}
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={() => handleSend()}
            onStop={handleStop}
            status={status}
            skillCount={skillCount}
          />
        </div>
      </div>
    </div>
  );
}
