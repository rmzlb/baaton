import { create } from 'zustand';

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface AIAssistantState {
  open: boolean;
  messages: AIMessage[];
  loading: boolean;
  input: string;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  setInput: (input: string) => void;
  addMessage: (role: 'user' | 'assistant', content: string) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
}

const STORAGE_KEY = 'baaton-ai-messages';

function loadMessages(): AIMessage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore
  }
  return [];
}

function saveMessages(messages: AIMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
  } catch {
    // ignore
  }
}

let nextId = 1;

export const useAIAssistantStore = create<AIAssistantState>((set, get) => ({
  open: false,
  messages: loadMessages(),
  loading: false,
  input: '',

  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  setInput: (input) => set({ input }),

  addMessage: (role, content) => {
    const msg: AIMessage = {
      id: `msg-${Date.now()}-${nextId++}`,
      role,
      content,
      timestamp: Date.now(),
    };
    const messages = [...get().messages, msg];
    saveMessages(messages);
    set({ messages });
  },

  setLoading: (loading) => set({ loading }),

  clearMessages: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ messages: [] });
  },
}));
