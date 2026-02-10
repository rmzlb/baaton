import { create } from 'zustand';
import type { SkillResult } from '@/lib/ai-skills';
import { type AIStateContext, createInitialState } from '@/lib/ai-state';

export type AIMode = 'gemini' | 'openclaw';

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  skills?: SkillResult[];
  usage?: { inputTokens: number; outputTokens: number };
}

interface AIAssistantState {
  open: boolean;
  messages: AIMessage[];
  loading: boolean;
  input: string;
  currentSkill: string | null;
  mode: AIMode;
  stateContext: AIStateContext;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  setInput: (input: string) => void;
  addMessage: (role: 'user' | 'assistant', content: string, skills?: SkillResult[], usage?: AIMessage['usage']) => void;
  setLoading: (loading: boolean) => void;
  setCurrentSkill: (skill: string | null) => void;
  setMode: (mode: AIMode) => void;
  setStateContext: (ctx: AIStateContext) => void;
  clearMessages: () => void;
}

const STORAGE_KEY = 'baaton-ai-messages';

function loadMessages(): AIMessage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveMessages(messages: AIMessage[]) {
  try {
    // Keep last 50, strip heavy data from skills for storage
    const lite = messages.slice(-50).map((m) => ({
      ...m,
      skills: m.skills?.map((s) => ({ ...s, data: undefined })),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lite));
  } catch { /* ignore */ }
}

let nextId = 1;

function loadMode(): AIMode {
  try {
    return (localStorage.getItem('baaton-ai-mode') as AIMode) || 'gemini';
  } catch { return 'gemini'; }
}

export const useAIAssistantStore = create<AIAssistantState>((set, get) => ({
  open: false,
  messages: loadMessages(),
  loading: false,
  input: '',
  currentSkill: null,
  mode: loadMode(),
  stateContext: createInitialState(),

  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  setInput: (input) => set({ input }),

  addMessage: (role, content, skills, usage) => {
    const msg: AIMessage = {
      id: `msg-${Date.now()}-${nextId++}`,
      role,
      content,
      timestamp: Date.now(),
      skills,
      usage,
    };
    const messages = [...get().messages, msg];
    saveMessages(messages);
    set({ messages });
  },

  setLoading: (loading) => set({ loading }),
  setCurrentSkill: (currentSkill) => set({ currentSkill }),

  setMode: (mode) => {
    localStorage.setItem('baaton-ai-mode', mode);
    set({ mode });
  },

  setStateContext: (stateContext) => set({ stateContext }),

  clearMessages: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ messages: [], stateContext: createInitialState() });
  },
}));
