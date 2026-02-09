/**
 * Tests for the AI assistant Zustand store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAIAssistantStore } from '@/stores/ai-assistant';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('useAIAssistantStore', () => {
  beforeEach(() => {
    localStorageMock.clear();
    useAIAssistantStore.setState({
      open: false,
      messages: [],
      loading: false,
      input: '',
      currentSkill: null,
    });
  });

  // ── toggle / setOpen ──

  it('starts closed', () => {
    expect(useAIAssistantStore.getState().open).toBe(false);
  });

  it('toggles open state', () => {
    useAIAssistantStore.getState().toggle();
    expect(useAIAssistantStore.getState().open).toBe(true);
    useAIAssistantStore.getState().toggle();
    expect(useAIAssistantStore.getState().open).toBe(false);
  });

  it('sets open explicitly', () => {
    useAIAssistantStore.getState().setOpen(true);
    expect(useAIAssistantStore.getState().open).toBe(true);
    useAIAssistantStore.getState().setOpen(false);
    expect(useAIAssistantStore.getState().open).toBe(false);
  });

  // ── input ──

  it('sets input text', () => {
    useAIAssistantStore.getState().setInput('hello');
    expect(useAIAssistantStore.getState().input).toBe('hello');
  });

  it('clears input', () => {
    useAIAssistantStore.getState().setInput('test');
    useAIAssistantStore.getState().setInput('');
    expect(useAIAssistantStore.getState().input).toBe('');
  });

  // ── messages ──

  it('adds a user message', () => {
    useAIAssistantStore.getState().addMessage('user', 'Hello AI');
    const messages = useAIAssistantStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello AI');
    expect(messages[0].id).toMatch(/^msg-/);
    expect(messages[0].timestamp).toBeGreaterThan(0);
  });

  it('adds an assistant message with skills', () => {
    const skills = [{ skill: 'search_issues', success: true, summary: 'Found 3 issues' }];
    useAIAssistantStore.getState().addMessage('assistant', 'Here are your issues', skills);
    const messages = useAIAssistantStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].skills).toEqual(skills);
  });

  it('persists messages to localStorage', () => {
    useAIAssistantStore.getState().addMessage('user', 'Persist me');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'baaton-ai-messages',
      expect.any(String),
    );
  });

  it('accumulates multiple messages', () => {
    useAIAssistantStore.getState().addMessage('user', 'Q1');
    useAIAssistantStore.getState().addMessage('assistant', 'A1');
    useAIAssistantStore.getState().addMessage('user', 'Q2');
    expect(useAIAssistantStore.getState().messages).toHaveLength(3);
  });

  // ── clearMessages ──

  it('clears all messages', () => {
    useAIAssistantStore.getState().addMessage('user', 'msg1');
    useAIAssistantStore.getState().addMessage('assistant', 'msg2');
    useAIAssistantStore.getState().clearMessages();
    expect(useAIAssistantStore.getState().messages).toHaveLength(0);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('baaton-ai-messages');
  });

  // ── loading / currentSkill ──

  it('sets loading state', () => {
    useAIAssistantStore.getState().setLoading(true);
    expect(useAIAssistantStore.getState().loading).toBe(true);
    useAIAssistantStore.getState().setLoading(false);
    expect(useAIAssistantStore.getState().loading).toBe(false);
  });

  it('sets current skill', () => {
    useAIAssistantStore.getState().setCurrentSkill('search_issues');
    expect(useAIAssistantStore.getState().currentSkill).toBe('search_issues');
    useAIAssistantStore.getState().setCurrentSkill(null);
    expect(useAIAssistantStore.getState().currentSkill).toBeNull();
  });
});
