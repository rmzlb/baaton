import { create } from 'zustand';
import type { SkillResult } from '@/lib/ai-skills';

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  skills?: SkillResult[];
}

interface AIAssistantState {
  open: boolean;
  messages: AIMessage[];
  loading: boolean;
  input: string;
  currentSkill: string | null;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  setInput: (input: string) => void;
  addMessage: (role: 'user' | 'assistant', content: string, skills?: SkillResult[]) => void;
  setLoading: (loading: boolean) => void;
  setCurrentSkill: (skill: string | null) => void;
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

export const useAIAssistantStore = create<AIAssistantState>((set, get) => ({
  open: false,
  messages: loadMessages(),
  loading: false,
  input: '',
  currentSkill: null,

  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  setInput: (input) => set({ input }),

  addMessage: (role, content, skills) => {
    const msg: AIMessage = {
      id: `msg-${Date.now()}-${nextId++}`,
      role,
      content,
      timestamp: Date.now(),
      skills,
    };
    const messages = [...get().messages, msg];
    saveMessages(messages);
    set({ messages });
  },

  setLoading: (loading) => set({ loading }),
  setCurrentSkill: (currentSkill) => set({ currentSkill }),

  clearMessages: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ messages: [] });
  },
}));
