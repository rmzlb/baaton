import { useRef, useEffect, useCallback } from 'react';
import { Sparkles, X, Send, Trash2, Bot, User } from 'lucide-react';
import { useAIAssistantStore, type AIMessage } from '@/stores/ai-assistant';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/shared/MarkdownView';

const SUGGESTIONS = [
  { label: '📊 Summarize progress', prompt: 'Summarize the current progress of this project' },
  { label: '🔄 Reprioritize', prompt: 'Help me reprioritize the open issues' },
  { label: '🚧 What\'s blocking?', prompt: 'What are the current blockers in this project?' },
  { label: '📋 Sprint review', prompt: 'Generate a sprint review summary' },
];

function generateMockResponse(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('summarize') || lower.includes('progress')) {
    return `## 📊 Project Progress Summary

Based on the current board:

- **Done:** Several tickets completed this sprint
- **In Progress:** Active development on key features
- **Blocked:** A few items need attention

### Key Highlights
1. The Kanban board is fully functional with drag & drop
2. Issue drawer with full CRUD operations
3. Tag system with project-level customization

> Want me to break down any specific area?`;
  }

  if (lower.includes('repriori') || lower.includes('priorit')) {
    return `## 🔄 Suggested Reprioritization

Here's my recommended priority order:

1. **🔴 Urgent** — Fix any blockers first
2. **🟠 High** — Complete in-progress features
3. **🟡 Medium** — New feature requests
4. **⚪ Low** — Nice-to-haves and polish

### Quick Actions
- Move all "urgent" bugs to the top of Todo
- Defer low-priority features to next sprint
- Focus on items with the most dependencies`;
  }

  if (lower.includes('block') || lower.includes('stuck')) {
    return `## 🚧 Current Blockers

Looking at the board, here are potential blockers:

1. **Dependencies** — Some tasks may depend on others not yet started
2. **Missing info** — Issues without descriptions need clarification
3. **Assignees** — Unassigned tickets risk falling through

### Suggestions
- Add descriptions to all in-progress issues
- Assign owners to unassigned urgent items
- Flag cross-team dependencies`;
  }

  if (lower.includes('sprint') || lower.includes('review')) {
    return `## 📋 Sprint Review

### Completed
- ✅ Core kanban board implementation
- ✅ Issue CRUD with drawer
- ✅ Tag management system
- ✅ Priority & status workflows

### In Progress
- 🔄 AI assistant integration
- 🔄 Markdown support
- 🔄 Category tags

### Metrics
- **Velocity:** Good pace maintained
- **Scope creep:** Minimal
- **Team health:** 🟢 Green`;
  }

  return `I'm your **Baaton AI assistant**! I can help with:

- 📊 **Summarize** project progress
- 🔄 **Reprioritize** issues intelligently  
- 🚧 **Identify blockers** in your workflow
- 📋 **Sprint reviews** and retrospectives
- 💡 **Suggestions** for process improvements

What would you like to know?`;
}

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
          <MarkdownView content={message.content} />
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
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-bounce" style={{ animationDelay: '300ms' }} />
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

      // Simulate API call delay
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 600));

      const response = generateMockResponse(msg);
      addMessage('assistant', response);
      setLoading(false);
    },
    [input, loading, setInput, addMessage, setLoading],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
          ref={panelRef}
          className="fixed bottom-20 right-6 z-40 flex w-[380px] max-h-[520px] flex-col rounded-xl border border-border bg-bg shadow-2xl overflow-hidden animate-slide-in-right"
          style={{ maxHeight: 'min(520px, calc(100vh - 120px))' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0 bg-surface">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500">
                <Sparkles size={14} />
              </div>
              <div>
                <h3 className="text-xs font-bold text-primary">Baaton AI</h3>
                <p className="text-[9px] text-muted">Project assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  onClick={clearMessages}
                  className="rounded-md p-1.5 text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
                  title="Clear history"
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
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 mb-3">
                  <Sparkles size={24} />
                </div>
                <h4 className="text-sm font-semibold text-primary mb-1">How can I help?</h4>
                <p className="text-xs text-muted mb-4 max-w-[240px]">
                  Ask about your project, get insights, or try a suggestion below.
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => handleSend(s.prompt)}
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] text-secondary hover:border-accent hover:text-accent transition-colors"
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
            <div className="border-t border-border px-3 py-2 shrink-0">
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {SUGGESTIONS.slice(0, 3).map((s) => (
                  <button
                    key={s.label}
                    onClick={() => handleSend(s.prompt)}
                    className="shrink-0 rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted hover:border-accent hover:text-accent transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="border-t border-border px-3 py-2.5 shrink-0">
            <div className="flex items-end gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything…"
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
              AI responses are mocked — backend coming soon
            </p>
          </div>
        </div>
      )}
    </>
  );
}
