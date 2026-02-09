import { useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, X, Send, Trash2, Bot, User, Loader2 } from 'lucide-react';
import { useAIAssistantStore, type AIMessage } from '@/stores/ai-assistant';
import { useApi } from '@/hooks/useApi';
import { generateAIResponse } from '@/lib/ai-engine';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/shared/MarkdownView';
import type { Issue } from '@/lib/types';

const SUGGESTIONS = [
  { label: '📊 Résumé projet', prompt: 'Fais-moi un résumé complet de l\'avancement de chaque projet' },
  { label: '🔄 Reprioriser', prompt: 'Aide-moi à reprioriser les issues ouvertes. Qu\'est-ce qui devrait être fait en premier ?' },
  { label: '🚧 Blockers ?', prompt: 'Quels sont les blockers actuels ? Qu\'est-ce qui est urgent et pas encore commencé ?' },
  { label: '📋 Sprint review', prompt: 'Génère un sprint review : ce qui a été fait, ce qui reste, les métriques' },
  { label: '🎯 Reste à faire', prompt: 'Fais-moi la liste de tout ce qui reste à faire, trié par priorité' },
  { label: '📈 Vélocité', prompt: 'Analyse la vélocité : combien de tickets done vs todo vs in progress par projet' },
];

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
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2',
          isUser
            ? 'bg-accent text-black'
            : 'bg-surface border border-border',
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
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-secondary mt-0.5">
        <Bot size={12} />
      </div>
      <div className="rounded-lg bg-surface border border-border px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin text-accent" />
          <span className="text-xs text-muted">Analyse en cours…</span>
        </div>
      </div>
    </div>
  );
}

export function AIAssistant() {
  const {
    open,
    messages,
    loading,
    input,
    toggle,
    setOpen,
    setInput,
    addMessage,
    setLoading,
    clearMessages,
  } = useAIAssistantStore();

  const apiClient = useApi();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch all projects
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Fetch issues for each project (cached)
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

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  const handleSend = useCallback(
    async (text?: string) => {
      const msg = (text ?? input).trim();
      if (!msg || loading) return;

      setInput('');
      addMessage('user', msg);
      setLoading(true);

      try {
        // Build conversation history for context
        const history = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const response = await generateAIResponse(
          msg,
          projects,
          allIssuesByProject,
          history,
        );

        addMessage('assistant', response);
      } catch (err) {
        console.error('AI error:', err);
        addMessage(
          'assistant',
          `⚠️ Erreur: ${err instanceof Error ? err.message : 'Impossible de générer une réponse'}. Réessaie dans un instant.`,
        );
      } finally {
        setLoading(false);
      }
    },
    [input, loading, messages, projects, allIssuesByProject, setInput, addMessage, setLoading],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const totalIssues = Object.values(allIssuesByProject).reduce((sum, arr) => sum + arr.length, 0);

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
          className="fixed bottom-20 right-6 z-40 flex w-[400px] max-h-[560px] flex-col rounded-xl border border-border bg-bg shadow-2xl overflow-hidden animate-slide-in-right"
          style={{ maxHeight: 'min(560px, calc(100vh - 120px))' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0 bg-surface">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500">
                <Sparkles size={14} />
              </div>
              <div>
                <h3 className="text-xs font-bold text-primary">Baaton AI</h3>
                <p className="text-[9px] text-muted">
                  {totalIssues > 0 ? `${totalIssues} issues · ${projects.length} projets` : 'Chargement…'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={clearMessages}
                  className="rounded-md p-1.5 text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
                  title="Effacer l'historique"
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
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 mb-3">
                  <Sparkles size={24} />
                </div>
                <h4 className="text-sm font-semibold text-primary mb-1">Que veux-tu savoir ?</h4>
                <p className="text-xs text-muted mb-4 max-w-[260px]">
                  Je connais tous tes projets et issues en temps réel. Pose-moi n'importe quelle question.
                </p>
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
                placeholder="Pose ta question…"
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
              Gemini Flash · données en temps réel
            </p>
          </div>
        </div>
      )}
    </>
  );
}
