import { useCallback, useRef, useState } from 'react';

// ─── Public types ────────────────────────────────────────────────────────────

/** A single tool call within an assistant message. */
export interface ToolCallEvent {
  /** Unique id for this tool invocation (same as the backend call id). */
  id: string;
  /** Name of the tool, e.g. "search_issues". */
  name: string;
  /** Arguments the model passed to the tool. */
  args: Record<string, unknown>;
  /** Lifecycle state of this tool call. */
  status: 'executing' | 'done' | 'error';
  /** Populated when status transitions to 'done' or 'error'. */
  result?: {
    /** React component name to render for this result, or null for markdown fallback. */
    component: string | null;
    /** Structured data for the component. */
    data: unknown;
    /** Human-readable summary (used as fallback). */
    summary: string;
  };
}

/** A message in the conversation. */
export interface AgentMessage {
  /** Stable unique id (crypto.randomUUID). */
  id: string;
  role: 'user' | 'assistant';
  /** Text content, streamed incrementally for assistant messages. */
  content: string;
  /** Tool calls attached to this assistant message. */
  toolCalls?: ToolCallEvent[];
  timestamp: number;
}

/** Token usage reported by the backend at the end of a stream. */
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Return value of useAgentChat. */
export interface UseAgentChatReturn {
  messages: AgentMessage[];
  sendMessage: (content: string) => Promise<void>;
  isStreaming: boolean;
  error: string | null;
  clearMessages: () => void;
  /** Load a set of messages into the hook (e.g. when restoring a saved conversation). */
  loadMessages: (messages: AgentMessage[]) => void;
  /** Abort the current in-flight stream without clearing messages. */
  abort: () => void;
  usage: AgentUsage | null;
}

/** Options for useAgentChat. */
export interface UseAgentChatOptions {
  /** Project ids to scope the agent's context. */
  projectIds: string[];
  /** Bearer token for API authentication (static fallback). */
  authToken?: string;
  /** Async function that returns a fresh auth token. Preferred over authToken. */
  getAuthToken?: () => Promise<string | null>;
  /** Base URL override; defaults to VITE_API_URL env var or empty string. */
  apiUrl?: string;
  /** Called when a tool_start event arrives. */
  onToolCall?: (name: string, args: unknown) => void;
  /** Called when the stream ends with usage stats. */
  onComplete?: (usage: AgentUsage) => void;
}

// ─── SSE parser ──────────────────────────────────────────────────────────────

interface SSEEvent {
  type: string;
  data: unknown;
}

/**
 * Parse one or more complete SSE message blocks from a raw string.
 * Returns the parsed events and any trailing incomplete buffer.
 */
function parseSSEChunk(raw: string): { events: SSEEvent[]; remainder: string } {
  const events: SSEEvent[] = [];
  const blocks = raw.split('\n\n');
  // Last element is either empty (if raw ended with \n\n) or an incomplete block
  const remainder = blocks.pop() ?? '';

  for (const block of blocks) {
    if (!block.trim()) continue;
    let eventType = 'message';
    let dataLine = '';

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLine = line.slice(5).trim();
      }
    }

    if (!dataLine) continue;

    try {
      events.push({ type: eventType, data: JSON.parse(dataLine) });
    } catch {
      // Skip malformed data lines
    }
  }

  return { events, remainder };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * useAgentChat — React hook for streaming AI agent conversations.
 *
 * Sends messages via POST /api/v1/ai/agent and reads the SSE response stream,
 * updating React state incrementally as each event arrives.
 *
 * @example
 * ```tsx
 * const { messages, sendMessage, isStreaming } = useAgentChat({
 *   projectIds: ['proj-1'],
 *   authToken: token,
 * });
 * ```
 */
export function useAgentChat(options: UseAgentChatOptions): UseAgentChatReturn {
  const {
    projectIds,
    authToken,
    getAuthToken,
    apiUrl = import.meta.env.VITE_API_URL ?? '',
    onToolCall,
    onComplete,
  } = options;

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<AgentUsage | null>(null);

  // AbortController ref so we can cancel an in-flight stream
  const abortRef = useRef<AbortController | null>(null);

  // ── State updaters (use functional form to avoid stale closures) ──────────

  const appendTextToLast = useCallback((content: string) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'assistant') return prev;
      return [
        ...prev.slice(0, -1),
        { ...last, content: last.content + content },
      ];
    });
  }, []);

  const addToolCall = useCallback((tool: ToolCallEvent) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== 'assistant') return prev;
      return [
        ...prev.slice(0, -1),
        {
          ...last,
          toolCalls: [...(last.toolCalls ?? []), tool],
        },
      ];
    });
  }, []);

  const updateToolCall = useCallback(
    (toolId: string, patch: Partial<ToolCallEvent>) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last.role !== 'assistant') return prev;
        const toolCalls = (last.toolCalls ?? []).map((tc) =>
          tc.id === toolId ? { ...tc, ...patch } : tc,
        );
        return [...prev.slice(0, -1), { ...last, toolCalls }];
      });
    },
    [],
  );

  // ── Main send handler ─────────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (content: string) => {
      if (isStreaming) return;

      // Cancel any previous stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setIsStreaming(true);

      // Add user message
      const userMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      // Snapshot of current messages for history payload
      let currentMessages: AgentMessage[] = [];
      setMessages((prev) => {
        currentMessages = prev;
        return [...prev, userMsg];
      });

      // Add empty assistant message to stream into
      const assistantMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        toolCalls: [],
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Track tool ids by name for pairing tool_start → tool_result
      // (names can repeat so we use a queue per name)
      const pendingToolIds = new Map<string, string[]>();

      try {
        // Get a fresh token for this request
        const token = getAuthToken ? (await getAuthToken()) : authToken;
        if (!token) {
          throw new Error('No auth token available');
        }

        const history = currentMessages.map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.role === 'assistant' && m.toolCalls?.length
            ? m.toolCalls
                .filter(tc => tc.status === 'done' && tc.result)
                .map(tc => ({
                  name: tc.name,
                  args: tc.args,
                  result_summary: tc.result?.summary ?? '',
                }))
            : undefined,
        }));

        const response = await fetch(`${apiUrl}/api/v1/ai/agent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: content,
            history,
            project_ids: projectIds,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(
            `HTTP ${response.status}${errText ? `: ${errText}` : ''}`,
          );
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { events, remainder } = parseSSEChunk(buffer);
          buffer = remainder;

          for (const event of events) {
            switch (event.type) {
              case 'text': {
                const d = event.data as { content: string };
                appendTextToLast(d.content);
                break;
              }

              case 'tool_start': {
                const d = event.data as {
                  name: string;
                  args: Record<string, unknown>;
                };
                const toolId = crypto.randomUUID();

                // Queue the id under this tool name
                const queue = pendingToolIds.get(d.name) ?? [];
                queue.push(toolId);
                pendingToolIds.set(d.name, queue);

                const toolCall: ToolCallEvent = {
                  id: toolId,
                  name: d.name,
                  args: d.args,
                  status: 'executing',
                };

                addToolCall(toolCall);
                onToolCall?.(d.name, d.args);
                break;
              }

              case 'tool_result': {
                const d = event.data as {
                  name: string;
                  component: string | null;
                  data: unknown;
                  summary: string;
                };

                // Dequeue the oldest pending id for this tool name
                const queue = pendingToolIds.get(d.name) ?? [];
                const toolId = queue.shift();
                if (queue.length === 0) {
                  pendingToolIds.delete(d.name);
                } else {
                  pendingToolIds.set(d.name, queue);
                }

                if (toolId) {
                  updateToolCall(toolId, {
                    status: 'done',
                    result: {
                      component: d.component,
                      data: d.data,
                      summary: d.summary,
                    },
                  });
                }
                break;
              }

              case 'done': {
                const d = event.data as {
                  usage: { input_tokens: number; output_tokens: number };
                };
                const u: AgentUsage = {
                  inputTokens: d.usage.input_tokens,
                  outputTokens: d.usage.output_tokens,
                };
                setUsage(u);
                onComplete?.(u);
                break;
              }

              case 'error': {
                const d = event.data as { message: string };
                setError(d.message);
                break;
              }

              default:
                break;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // Cancelled — not an error
        } else {
          const msg =
            err instanceof Error ? err.message : 'Unknown error occurred';
          setError(msg);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        // Remove ghost assistant messages (no content and no tool calls)
        setMessages((prev) =>
          prev.filter(
            (m) =>
              m.role !== 'assistant' ||
              m.content.trim() !== '' ||
              (m.toolCalls && m.toolCalls.length > 0),
          ),
        );
      }
    },
    [
      isStreaming,
      apiUrl,
      authToken,
      getAuthToken,
      projectIds,
      appendTextToLast,
      addToolCall,
      updateToolCall,
      onToolCall,
      onComplete,
    ],
  );

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setUsage(null);
  }, []);

  const loadMessages = useCallback((msgs: AgentMessage[]) => {
    setMessages(msgs);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { messages, sendMessage, isStreaming, error, clearMessages, loadMessages, abort, usage };
}
