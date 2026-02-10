import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  transition,
  stateToSkillContext,
  checkRateLimit,
  estimateTokens,
  checkBudget,
  summarizeHistory,
  TOKEN_BUDGET,
} from '../ai-state';

describe('ai-state', () => {
  describe('createInitialState', () => {
    it('creates state with idle state and zero usage', () => {
      const state = createInitialState();
      expect(state.state).toBe('idle');
      expect(state.usage.totalTokens).toBe(0);
      expect(state.usage.turnCount).toBe(0);
      expect(state.usage.skillCalls).toBe(0);
      expect(state.errorCount).toBe(0);
      expect(state.lastSkills).toEqual([]);
    });
  });

  describe('transitions', () => {
    it('USER_MESSAGE: idle → chatting, increments tokens and turns', () => {
      const state = createInitialState();
      const next = transition(state, { type: 'USER_MESSAGE', tokens: 100 });
      expect(next.state).toBe('chatting');
      expect(next.usage.inputTokens).toBe(100);
      expect(next.usage.turnCount).toBe(1);
    });

    it('SKILL_STARTED: chatting → planning when plan_milestones', () => {
      let state = createInitialState();
      state = transition(state, { type: 'USER_MESSAGE', tokens: 50 });
      state = transition(state, { type: 'SKILL_STARTED', name: 'plan_milestones' });
      expect(state.state).toBe('planning');
      expect(state.usage.skillCalls).toBe(1);
    });

    it('SKILL_STARTED: chatting → executing when create_milestones_batch', () => {
      let state = createInitialState();
      state = transition(state, { type: 'USER_MESSAGE', tokens: 50 });
      state = transition(state, { type: 'SKILL_STARTED', name: 'create_milestones_batch' });
      expect(state.state).toBe('executing');
    });

    it('SKILL_STARTED: chatting → reporting when get_project_metrics', () => {
      let state = createInitialState();
      state = transition(state, { type: 'USER_MESSAGE', tokens: 50 });
      state = transition(state, { type: 'SKILL_STARTED', name: 'get_project_metrics' });
      expect(state.state).toBe('reporting');
    });

    it('SKILL_COMPLETED: plan_milestones → plan_proposed with cached data', () => {
      let state = createInitialState();
      state = transition(state, { type: 'USER_MESSAGE', tokens: 50 });
      state = transition(state, { type: 'SKILL_STARTED', name: 'plan_milestones' });
      state = transition(state, {
        type: 'SKILL_COMPLETED',
        name: 'plan_milestones',
        data: {
          project_id: 'abc',
          proposed_milestones: [{ name: 'M1', issue_ids: ['1'] }],
        },
      });
      expect(state.state).toBe('plan_proposed');
      expect(state.pendingPlan?.projectId).toBe('abc');
      expect(state.lastSkills).toContain('plan_milestones');
    });

    it('SKILL_COMPLETED: create_milestones_batch → chatting, clears pendingPlan', () => {
      let state = createInitialState();
      state.pendingPlan = { projectId: 'abc', milestones: [] };
      state = transition(state, { type: 'SKILL_COMPLETED', name: 'create_milestones_batch' });
      expect(state.state).toBe('chatting');
      expect(state.pendingPlan).toBeUndefined();
    });

    it('SKILL_FAILED: increments errorCount, 3 failures → error state', () => {
      let state = createInitialState();
      state = transition(state, { type: 'USER_MESSAGE', tokens: 50 });
      state = transition(state, { type: 'SKILL_FAILED', name: 'search_issues', error: 'timeout' });
      expect(state.errorCount).toBe(1);
      expect(state.state).toBe('chatting');
      state = transition(state, { type: 'SKILL_FAILED', name: 'search_issues', error: 'timeout' });
      expect(state.errorCount).toBe(2);
      state = transition(state, { type: 'SKILL_FAILED', name: 'search_issues', error: 'timeout' });
      expect(state.errorCount).toBe(3);
      expect(state.state).toBe('error');
    });

    it('AI_RESPONSE: tracks output tokens', () => {
      let state = createInitialState();
      state = transition(state, { type: 'AI_RESPONSE', tokens: 200 });
      expect(state.usage.outputTokens).toBe(200);
      expect(state.usage.totalTokens).toBe(200);
    });

    it('ERROR: transitions to error state', () => {
      let state = createInitialState();
      state = transition(state, { type: 'ERROR', error: 'Network error' });
      expect(state.state).toBe('error');
      expect(state.errorCount).toBe(1);
    });

    it('RESET: returns fresh initial state', () => {
      let state = createInitialState();
      state = transition(state, { type: 'USER_MESSAGE', tokens: 1000 });
      state = transition(state, { type: 'RESET' });
      expect(state.state).toBe('idle');
      expect(state.usage.totalTokens).toBe(0);
    });
  });

  describe('stateToSkillContext', () => {
    it('plan_proposed → milestone_confirm', () => {
      const state = { ...createInitialState(), state: 'plan_proposed' as const };
      expect(stateToSkillContext(state)).toBe('milestone_confirm');
    });

    it('planning → milestone_planning', () => {
      const state = { ...createInitialState(), state: 'planning' as const };
      expect(stateToSkillContext(state)).toBe('milestone_planning');
    });

    it('reporting → read_only', () => {
      const state = { ...createInitialState(), state: 'reporting' as const };
      expect(stateToSkillContext(state)).toBe('read_only');
    });

    it('chatting → default', () => {
      const state = { ...createInitialState(), state: 'chatting' as const };
      expect(stateToSkillContext(state)).toBe('default');
    });
  });

  describe('estimateTokens', () => {
    it('estimates ~1 token per 3.5 chars', () => {
      expect(estimateTokens('hello world')).toBeGreaterThan(0);
      expect(estimateTokens('a'.repeat(350))).toBe(100);
    });

    it('handles empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('checkBudget', () => {
    it('returns ok when under budget', () => {
      const state = createInitialState();
      const result = checkBudget(state);
      expect(result.ok).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('warns when approaching budget (80%+)', () => {
      const state = createInitialState();
      state.usage.totalTokens = TOKEN_BUDGET.warnAt + 1;
      const result = checkBudget(state);
      expect(result.ok).toBe(true);
      expect(result.warning).toBeDefined();
    });

    it('blocks when over budget', () => {
      const state = createInitialState();
      state.usage.totalTokens = TOKEN_BUDGET.maxPerSession + 1;
      const result = checkBudget(state);
      expect(result.ok).toBe(false);
      expect(result.warning).toBeDefined();
    });
  });

  describe('summarizeHistory', () => {
    it('returns unchanged history when under threshold', () => {
      const history = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));
      expect(summarizeHistory(history)).toHaveLength(10);
    });

    it('summarizes when over threshold (16+)', () => {
      const history = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));
      const result = summarizeHistory(history);
      expect(result.length).toBeLessThan(20);
      // Should have first 2 + summary pair + last 6 = 10
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });

  describe('checkRateLimit', () => {
    it('allows first call', () => {
      const result = checkRateLimit();
      expect(result.allowed).toBe(true);
    });
  });
});
